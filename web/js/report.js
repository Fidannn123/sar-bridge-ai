/* Download the selected report with original measurements and source provenance. */
"use strict";
window.SBReport = (() => {
  function markdown(unit, data) {
    const dc = unit.detected_change;
    const ai = unit.ai_explanation;
    const lines = [
      "# SAR-BRIDGE AI — Environmental evidence report",
      "",
      `Area: ${unit.name}`,
      `Radar observation pair: ${dc.dates.join(" → ")}`,
      `Data generated (UTC): ${data.stats.generated_utc}`,
      "",
      "## Measured change",
      "",
      dc.what,
      "",
      `- Water loss: ${dc.loss_ha} ha`,
      `- Water gain: ${dc.gain_ha} ha`,
      `- Net change: ${dc.net_change_ha} ha`,
      `- Valid coverage: ${(dc.valid_fraction * 100).toFixed(2)}%`,
      "",
      "## Evidence-engine conclusion",
      "",
      unit.conclusion.label,
      "",
      unit.conclusion.reason || unit.conclusion.summary,
      "",
      "## Possible explanations",
      "",
    ];
    for (const h of unit.hypotheses || []) {
      lines.push(
        `### ${h.title}`,
        "",
        `Status: ${h.status_label}`,
        "",
        h.note || "",
        "",
      );
      for (const e of h.evidence || [])
        lines.push(`- [${e.direction}] ${e.statement} — Source: ${e.source}`);
      lines.push("");
    }
    if (ai)
      lines.push(
        "## Plain-language interpretation",
        "",
        ai.text,
        "",
        `Text source: ${ai.source === "openai" ? `language model (${ai.model})` : "evidence-engine template"}. Numbers verified: ${ai.numbers_verified ? "yes" : "no"}.`,
        "",
      );
    lines.push(
      "## Independent optical-proxy comparison",
      "",
      "The comparison is against Sentinel-2, not field ground truth. Pixel-exact disagreement includes date and sensor differences.",
      "",
    );
    const comparison =
      unit.id === undefined
        ? data.validation?.study_area
        : data.validation?.sectors.find((item) => item.id === unit.id);
    if (comparison)
      for (const kind of ["loss", "gain"]) {
        const m = comparison[kind];
        lines.push(
          `- Water ${kind}: precision ${m.precision ?? "n/a"}; recall ${m.recall ?? "n/a"}; F1 ${m.f1 ?? "n/a"}; IoU ${m.iou ?? "n/a"}.`,
          `  Common-valid pixel counts: overlap ${m.tp_px}, radar only ${m.fp_px}, optical only ${m.fn_px}, neither ${m.tn_px}.`,
        );
      }
    const review = window.SBReview?.reportFor(unit);
    lines.push(
      "",
      "## Human review",
      "",
      "Local browser demo. Reviewer identities and submitted evidence are self-reported, not authenticated sign-offs.",
      `Analysis package: ${data.validation?.package_id || "unavailable"}`,
      "",
    );
    if (review?.records.length)
      for (const record of review.records) {
        lines.push(
          `- Reviewer: ${record.reviewer}; time (UTC): ${record.created_utc}`,
          `  Outcome: ${window.SBReviewStore.outcomes[record.outcome]}`,
          `  Rationale: ${record.rationale}`,
          `  Next action: ${window.SBReviewStore.actions[record.next_action]}`,
          `  Evidence reference: ${record.evidence_reference || "not supplied"}`,
          `  Record ID: ${record.id}`,
          "",
        );
      }
    else
      lines.push(
        review?.storage_available === false
          ? "Review storage is unavailable in this browser."
          : "Awaiting human review for this analysis package.",
        "",
      );
    lines.push(
      "## Missing evidence",
      "",
      ...(unit.missing_evidence || []).map((e) => `- ${e}`),
      "",
      "## Observation provenance",
      "",
    );
    for (const side of ["before", "after"]) {
      const g = data.meta.nisar.pair[side];
      lines.push(
        `- ${side}: ${g.start_time} / ${g.granule_id}`,
        `  ${g.cmr_url}`,
      );
    }
    lines.push(
      "",
      "## Data sources",
      "",
      ...data.meta.sources.map((s) => `- ${s.name}: ${s.url}`),
      "",
      "## Limitations",
      "",
      ...data.meta.limitations.map((l) => `- ${l}`),
      "",
      "Research prototype. No causal, forecasting, dam-safety or hazard-warning claim.",
      "",
    );
    return lines.join("\n");
  }
  function download(unit, data) {
    const blob = new Blob([markdown(unit, data)], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `SAR-BRIDGE-${unit.id ? `sector-${unit.id}` : "reservoir"}-${unit.detected_change.dates[1]}.md`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return { markdown, download };
})();
