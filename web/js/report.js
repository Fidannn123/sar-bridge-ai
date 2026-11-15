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
