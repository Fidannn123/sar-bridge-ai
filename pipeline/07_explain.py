"""Turn the structured evidence into plain-language explanations with an LLM (OpenAI).

The LLM never sees raw imagery and never decides anything: it receives the
evidence engine's structured output for one sector and rewrites it as prose.
Guardrails:
  * strict instructions (no outside facts, no causal claims, exact status wording);
  * automatic number check - every number in the generated text must trace back
    to a value in the input JSON; otherwise the model is asked to rewrite once,
    and any remaining unverified numbers are flagged in the UI;
  * if no API key is configured, a deterministic template is used and labelled
    as such (never presented as AI-written).

Explanations are generated once, offline; the public website only displays them,
so no API key is ever exposed. Results are cached by input hash.

Output: updates web/data/analysis.json in place (field "ai_explanation").
"""
from __future__ import annotations

import hashlib
import json
import os
import re

from common import load_env, read_json, step, utc_now, write_json
from config import CONTEXT, OPENAI_MODEL_DEFAULT, WEB_DATA

CACHE = CONTEXT / "llm_cache.json"

INSTRUCTIONS = """You write the plain-language interpretation for one map area in SAR-BRIDGE AI, a research prototype that compares two NASA-ISRO NISAR L-band radar observations of the Mingachevir Reservoir, Azerbaijan, and evaluates possible explanations with a transparent rule-based evidence engine.

Strict rules:
1. Use ONLY the facts and numbers in the JSON you receive. Do not add outside knowledge, place names, causes, dates or numbers. You may round numbers but not invent new ones (no totals or percentages you compute yourself).
2. Keep measurements and hypotheses clearly apart: first say what was measured, then what might explain it.
3. Never state or imply that a cause is confirmed or proven. When naming a hypothesis's status use the exact wording from the JSON ("Supported hypothesis", "Plausible but unconfirmed", "Insufficient evidence", "Not supported by available data"). "Supported hypothesis" means consistent with independent data, not proven.
4. Values from ERA5 / ERA5-Land are model reanalysis: call them "modelled", not measured.
5. "water_that_became_land_ha" is water LOSS (shoreline retreat); "land_that_became_water_ha" is water GAIN. Never swap them. Do not state any total water area.
6. State the conclusion using the exact wording of "required_conclusion_label" (once), and explain it using "why_this_conclusion" - do not invent other reasons. Never give a hypothesis a different status from the one in the JSON, and do not combine status labels. If "significant_change" is false, say there is nothing to explain and do not attribute the stability to any hypothesis.
6b. Never mention JSON field names.
7. Name the most important missing evidence.
8. Never describe the system as a dam-safety, hazard-warning or prediction tool.
9. 110-170 words, two short paragraphs, plain text only: no headings, no lists, no markdown."""


STATUS_LABELS = ["Supported hypothesis", "Plausible but unconfirmed", "Insufficient evidence",
                 "Not supported by available data", "No significant change detected"]


def payload_for(unit: dict, ctx: dict) -> dict:
    """Unambiguous, minimal view of the evidence for the LLM (clear names, no easily misread totals)."""
    dc = unit["detected_change"]
    hyps = []
    for h in (unit.get("hypotheses", [])[:5] if unit.get("significant_change") else []):
        hyps.append({"hypothesis": h["title"], "status": h.get("status_label"), "note": h.get("note"),
                     "evidence": [{"statement": e["statement"], "source": e["source"], "direction": e["direction"]}
                                  for e in h["evidence"]]})
    return {
        "area": unit.get("name"), "position": unit.get("position"),
        "observations": {"sensor": "NISAR L-band radar (GCOV), HH polarisation used for water mapping, 20 m grid",
                         "dates": dc["dates"]},
        "measured_change": {
            "summary": dc["what"],
            "water_that_became_land_ha": dc["loss_ha"],
            "land_that_became_water_ha": dc["gain_ha"],
            "net_change_ha": dc["net_change_ha"],
            "valid_data_percent": None if dc["valid_fraction"] is None else round(100 * dc["valid_fraction"], 1),
            "significant_change": unit.get("significant_change", False),
        },
        "required_conclusion_label": unit["conclusion"]["label"],
        "strongest_hypothesis": unit["conclusion"].get("top_hypothesis"),
        "why_this_conclusion": unit["conclusion"].get("reason"),
        "hypotheses_ranked": hyps,
        "missing_evidence": unit.get("missing_evidence", []),
    }


BANNED = ["caused by", "proves", "proven", "confirmed that", "confirms that", "definitely", "certainly",
          "dam safety", "dam-safety", "will happen", "predict", "validated", "confirming", "required conclusion",
          "required_conclusion", "why_this", "strongest_hypothesis", "attributed to"]


def semantic_issues(text: str, payload: dict) -> list[str]:
    """Checks beyond numbers: exact status wording, no stray labels, no causal claims, no loss/gain inversion."""
    issues, low = [], text.lower()
    label = payload["required_conclusion_label"]
    if label.lower() not in low:
        issues.append(f'the conclusion label "{label}" must appear verbatim')
    allowed = {label.lower()} | {(h["status"] or "").lower() for h in payload["hypotheses_ranked"]}
    for lab in STATUS_LABELS:
        if lab.lower() in low and lab.lower() not in allowed:
            issues.append(f'"{lab}" is not the status of anything in this area')
    for b in BANNED:
        if b in low:
            issues.append(f'avoid the phrase "{b}"')
    mc = payload["measured_change"]
    if mc["water_that_became_land_ha"] and re.search(r"\bno (instances? of |areas? of )?water (becom\w*|became|turn\w*) (into )?land", low):
        issues.append("states that no water became land, but water did become land (loss and gain are swapped)")
    if not mc["land_that_became_water_ha"] and re.search(r"\b\d[\d,.]* (hectares|ha) of land (became|turned|becoming)", low):
        issues.append("claims land became water, but none did")
    return issues


# ----------------------------------------------------------------------------- number check
NUM_RE = re.compile(r"(?<![A-Za-z])[-+]?\d[\d,]*(?:\.\d+)?")


def _numbers_in(obj, out: set[float]):
    if isinstance(obj, dict):
        for v in obj.values():
            _numbers_in(v, out)
    elif isinstance(obj, list):
        for v in obj:
            _numbers_in(v, out)
    elif isinstance(obj, bool):
        return
    elif isinstance(obj, (int, float)):
        out.add(float(obj))
        if abs(obj) <= 1:
            out.add(round(float(obj) * 100, 1))          # fractions are shown as percentages
    elif isinstance(obj, str):
        for tok in NUM_RE.findall(obj):
            try:
                out.add(float(tok.replace(",", "")))
            except ValueError:
                pass


def check_numbers(text: str, payload: dict) -> tuple[list[str], int]:
    """Return (numbers not traceable to the payload, count of numbers checked)."""
    allowed: set[float] = set()
    _numbers_in(payload, allowed)
    allowed |= {abs(a) for a in allowed}
    bad, checked = [], 0
    for tok in NUM_RE.findall(text):
        try:
            v = abs(float(tok.replace(",", "").lstrip("+")))
        except ValueError:
            continue
        if v in (0, 1, 2) and len(tok) <= 2:       # 'two short paragraphs' style small integers are fine
            continue
        checked += 1
        if not any(abs(v - a) <= max(0.51, 0.01 * abs(a)) for a in allowed):
            bad.append(tok)
    return bad, checked


def unverified_numbers(text: str, payload: dict) -> list[str]:
    return check_numbers(text, payload)[0]


# ----------------------------------------------------------------------------- generation
def template_text(unit: dict) -> str:
    d, c = unit["detected_change"], unit["conclusion"]
    parts = [f"Measured: {d['what']} Observations: {d['dates'][0]} and {d['dates'][1]}; "
             f"{round(100 * (d['valid_fraction'] or 0))}% of the area had valid radar data on both dates."]
    if unit.get("hypotheses") and unit.get("significant_change"):
        top = unit["hypotheses"][0]
        parts.append(f"Interpretation: the explanation with the strongest available support is '{top['title']}' "
                     f"({top['status_label']}). This is a hypothesis, not an established cause.")
    else:
        parts.append(f"Conclusion: {c['label']}.")
    if unit.get("missing_evidence"):
        parts.append("Missing evidence includes: " + "; ".join(unit["missing_evidence"][:2]) + ".")
    return " ".join(parts)


def generate(client, model: str, payload: dict) -> tuple[str, list[str], list[str], int]:
    """Returns (text, unverified numbers, semantic issues, attempts)."""
    text_in = json.dumps(payload, ensure_ascii=False, indent=1)
    resp = client.responses.create(model=model, instructions=INSTRUCTIONS, input=text_in)
    text = resp.output_text.strip()
    bad, issues = unverified_numbers(text, payload), semantic_issues(text, payload)
    attempts = 1
    if bad or issues:
        problems = ([f"numbers not in the JSON: {', '.join(bad)}"] if bad else []) + issues
        retry = (text_in + "\n\nYour previous draft was rejected by automatic checks:\n- " + "\n- ".join(problems)
                 + "\nRewrite it so that all checks pass, following every rule.")
        resp = client.responses.create(model=model, instructions=INSTRUCTIONS, input=retry)
        text = resp.output_text.strip()
        bad, issues = unverified_numbers(text, payload), semantic_issues(text, payload)
        attempts = 2
    return text, bad, issues, attempts


def main():
    step("AI explanations (OpenAI)")
    load_env()
    analysis = read_json(WEB_DATA / "analysis.json")
    cache = read_json(CACHE) if CACHE.exists() else {}
    model = os.environ.get("OPENAI_MODEL") or OPENAI_MODEL_DEFAULT
    client = None
    if os.environ.get("OPENAI_API_KEY"):
        from openai import OpenAI
        client = OpenAI()
    else:
        print("  OPENAI_API_KEY not set -> using labelled template text (no LLM)")

    units = [analysis["study_area"]] + analysis["sectors"]
    for unit in units:
        payload = payload_for(unit, analysis["context"])
        key = hashlib.sha256((model + INSTRUCTIONS + json.dumps(payload, sort_keys=True)).encode()).hexdigest()
        if client is None:
            unit["ai_explanation"] = {"text": template_text(unit), "source": "template",
                                      "model": None, "numbers_verified": True, "unverified_numbers": []}
            continue
        if key in cache:
            unit["ai_explanation"] = cache[key]
            print(f"  {unit['name']}: cached")
            continue
        try:
            text, bad, issues, attempts = generate(client, model, payload)
            if issues or bad:
                # never publish a draft that failed the checks: fall back to the deterministic template
                unit["ai_explanation"] = {"text": template_text(unit), "source": "template", "model": None,
                                          "numbers_verified": True, "unverified_numbers": [],
                                          "rejected_llm_draft": {"model": model, "issues": issues, "unverified_numbers": bad}}
                print(f"  {unit['name']}: LLM draft REJECTED after {attempts} attempts ({issues + bad}); template used")
            else:
                unit["ai_explanation"] = {"text": text, "source": "openai", "model": model, "generated_utc": utc_now(),
                                          "numbers_verified": True, "unverified_numbers": [],
                                          "numbers_checked": check_numbers(text, payload)[1],
                                          "semantic_checks_passed": True, "attempts": attempts}
                cache[key] = unit["ai_explanation"]
                print(f"  {unit['name']}: {len(text.split())} words, all checks passed (attempts={attempts})")
        except Exception as ex:  # keep the demo runnable; label the fallback honestly
            print(f"  {unit['name']}: LLM call failed ({type(ex).__name__}: {str(ex)[:120]}); using template")
            if type(ex).__name__ in ("AuthenticationError", "PermissionDeniedError", "NotFoundError"):
                print("  -> stopping LLM calls for this run (fix OPENAI_API_KEY / OPENAI_MODEL in .env and re-run step 07)")
                client = None
            unit["ai_explanation"] = {"text": template_text(unit), "source": "template", "model": None,
                                      "numbers_verified": True, "unverified_numbers": [], "error": type(ex).__name__}
    write_json(CACHE, cache)
    write_json(WEB_DATA / "analysis.json", analysis)


if __name__ == "__main__":
    main()
