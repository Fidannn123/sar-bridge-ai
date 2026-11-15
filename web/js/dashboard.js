/* Observation overview. Rule verdicts and local review records are separate axes. */
"use strict";
window.SBDashboard = (() => {
  const shortLabels = {
    supported: "Supported hypothesis",
    plausible: "Plausible but unconfirmed",
    insufficient: "Insufficient evidence",
    no_change: "No significant change",
    not_supported: "Not supported by data",
  };
  function summarize(data, reviewFor) {
    const engine = {},
      human = {
        reviewed: 0,
        needs_data: 0,
        disputed: 0,
        pending: 0,
        unavailable: 0,
      };
    const rows = data.analysis.sectors
      .map((unit) => {
        engine[unit.conclusion.status] =
          (engine[unit.conclusion.status] || 0) + 1;
        const review = reviewFor(unit);
        const latest = review?.records.at(-1);
        const state = !review?.storage_available
          ? "unavailable"
          : latest?.outcome || "pending";
        human[state]++;
        return { unit, human: state };
      })
      .sort(
        (a, b) =>
          b.unit.detected_change.loss_ha - a.unit.detected_change.loss_ha ||
          a.unit.id - b.unit.id,
      );
    return {
      rows,
      engine,
      human,
      total: rows.length,
      changed: rows.filter((row) => row.unit.significant_change).length,
      recorded: human.reviewed + human.needs_data + human.disputed,
      storage_available: human.unavailable === 0,
    };
  }
  function create({ data, openMap }) {
    const root = document.querySelector("#dashboard");
    const esc = (value) =>
      String(value ?? "").replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      );
    const num = (n, digits = 1) =>
      Number.isFinite(n)
        ? n.toLocaleString("en-US", {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits,
          })
        : "n/a";
    const date = (value) =>
      new Date(`${value}T12:00:00Z`).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
    const humanLabel = (state) =>
      ({
        pending: "Pending",
        unavailable: "Storage unavailable",
        ...SBReviewStore.outcomes,
      })[state];
    let changedOnly = false;
    const total = data.analysis.study_area,
      dc = total.detected_change;
    function evaluationHTML() {
      const result = data.evaluation;
      return `<section class="dashboard-performance" aria-labelledby="evaluation-title"><p class="comparison-score-label">PROJECT / TEAM-REPORTED RESULTS</p><h2 id="evaluation-title">Evaluation summary</h2><div class="evaluation-f1"><span>F1 score</span><strong id="evaluation-f1">${num(result.f1, 2)}<small> / 1</small></strong></div><dl class="evaluation-rates"><div><dt>Precision</dt><dd id="evaluation-precision">${num(result.precision * 100, 0)}<small>%</small></dd></div><div><dt>Recall</dt><dd id="evaluation-recall">${num(result.recall * 100, 0)}<small>%</small></dd></div></dl><p class="dashboard-small">Source: project team. Evaluation dataset and averaging method have not been supplied.</p></section>`;
    }
    function refresh() {
      const summary = summarize(data, (unit) => SBReview.reportFor(unit));
      const rows = summary.rows.filter(
        (row) => !changedOnly || row.unit.significant_change,
      );
      const maximum = Math.max(
        ...summary.rows.map((row) => row.unit.detected_change.loss_ha),
        1,
      );
      const oldFocused = root.contains(document.activeElement)
        ? document.activeElement.dataset.focusKey
        : null;
      root.innerHTML = `<div class="dashboard-heading"><div><h1 id="dashboard-title" tabindex="-1">Reservoir overview</h1><p>Mingachevir Reservoir · ${esc(dc.dates.map(date).join(" → "))}</p></div><div class="dashboard-actions"><button class="journey-primary" data-dashboard-map="reservoir" type="button">Open map <span aria-hidden="true">→</span></button><button class="btn" data-dashboard-action="report" type="button">Reservoir report</button></div></div>
        <div class="dashboard-metrics" aria-label="Observation and review summary"><div class="loss"><strong>${num(dc.loss_ha)}<small> ha</small></strong><span>Radar-indicated loss</span></div><div><strong>${summary.changed}<small> / ${summary.total}</small></strong><span>Sectors with significant change</span></div><div><strong id="dashboard-recorded">${summary.storage_available ? `${summary.recorded}<small> / ${summary.total}</small>` : "n/a"}</strong><span>Sectors with a recorded review</span><small>Local browser${summary.storage_available ? "" : " · storage unavailable"}</small></div><div><strong>${num(dc.valid_fraction * 100, 2)}<small>%</small></strong><span>Valid radar coverage</span><small>Not accuracy</small></div></div>
        <p class="dashboard-note">Two-date investigation. Review records are local and self-reported. Queue order is not a hazard ranking.</p>
        <div class="dashboard-grid"><section class="dashboard-sectors" aria-labelledby="dashboard-sector-title"><div class="dashboard-section-head"><div><h2 id="dashboard-sector-title">Sector comparison</h2><p>Sorted by radar loss area.</p></div><label class="dashboard-filter"><input id="dashboard-changed-only" type="checkbox" ${changedOnly ? "checked" : ""} data-focus-key="filter"> Changed sectors only</label><span id="dashboard-row-count">${rows.length} sectors</span></div>
          <p class="dashboard-scroll-hint">Scroll the table sideways to see engine status, human review and actions.</p><div class="dashboard-table-scroll" tabindex="0" role="region" aria-label="Sector measurements and review actions"><table class="dashboard-table"><caption class="sr-only">Radar loss, evidence-engine result and local human review for each sector</caption><thead><tr><th scope="col">Sector</th><th scope="col">Radar loss</th><th scope="col">Evidence engine</th><th scope="col">Human review</th><th scope="col">Actions</th></tr></thead><tbody>${rows.map(({ unit, human }) => `<tr data-dashboard-sector="${unit.id}"><th scope="row">Sector ${String(unit.id).padStart(2, "0")}</th><td><div class="dashboard-loss"><span class="dashboard-bar" aria-hidden="true"><i style="width:${(unit.detected_change.loss_ha / maximum) * 100}%"></i></span><span>${num(unit.detected_change.loss_ha)} ha</span></div></td><td><span class="chip ${esc(unit.conclusion.status)}" title="${esc(unit.conclusion.label)}">${esc(shortLabels[unit.conclusion.status] || unit.conclusion.label)}</span></td><td><span class="human-state ${human}">${esc(humanLabel(human))}</span></td><td class="dashboard-row-actions"><button class="btn" data-dashboard-map="${unit.id}" aria-label="Open Sector ${unit.id} on map" type="button">Map</button><button class="btn" data-dashboard-review="${unit.id}" data-focus-key="review-${unit.id}" aria-label="Review Sector ${unit.id}" type="button">Review</button></td></tr>`).join("")}</tbody></table></div>
          <div class="dashboard-engine"><strong>Engine results <small>All ${summary.total} sectors</small></strong>${Object.entries(
            summary.engine,
          )
            .map(
              ([key, count]) =>
                `<span class="chip ${esc(key)}"><b>${count}</b> ${esc(shortLabels[key] || data.analysis.status_labels[key] || key)}</span>`,
            )
            .join(
              "",
            )}<span>This counts rules separately from people.</span></div></section>
          <aside class="dashboard-rail" aria-label="Team-reported evaluation and human review">${evaluationHTML()}
          <section class="dashboard-human"><h2>Human review</h2><p id="dashboard-review-summary">${summary.storage_available ? `<strong>${summary.recorded} of ${summary.total}</strong> sectors have a recorded review.` : "Local storage is unavailable. Review coverage cannot be determined."}</p>${summary.storage_available ? `<progress value="${summary.recorded}" max="${summary.total}" aria-label="Sectors with a recorded local review">${summary.recorded} / ${summary.total}</progress>` : ""}<dl>${Object.entries(
            summary.human,
          )
            .filter(([key, count]) => key !== "unavailable" || count)
            .map(
              ([key, count]) =>
                `<div><dt>${esc(humanLabel(key))}</dt><dd>${count}</dd></div>`,
            )
            .join(
              "",
            )}</dl><button class="journey-primary" data-dashboard-action="queue" type="button">Open review queue</button><p class="dashboard-small">Local browser demo. Names are not authenticated. A recorded review is not approval of the science.</p></section></aside></div>
        <footer class="dashboard-footer"><span>Source: NASA–ISRO NISAR</span><span>Package ${esc(data.validation.package_id.slice(0, 12))}</span><button class="journey-text-button" data-dashboard-action="method" type="button">Source and methods <span aria-hidden="true">↗</span></button></footer>`;
      if (oldFocused)
        [...root.querySelectorAll("[data-focus-key]")]
          .find((node) => node.dataset.focusKey === oldFocused)
          ?.focus({ preventScroll: true });
      root
        .querySelector("#dashboard-changed-only")
        .addEventListener("change", (event) => {
          changedOnly = event.target.checked;
          refresh();
        });
    }
    root.addEventListener("click", (event) => {
      const mapButton = event.target.closest("[data-dashboard-map]");
      if (mapButton)
        openMap(
          mapButton.dataset.dashboardMap === "reservoir"
            ? null
            : Number(mapButton.dataset.dashboardMap),
        );
      const reviewButton = event.target.closest("[data-dashboard-review]");
      if (reviewButton)
        SBReview.open({
          unit: data.analysis.sectors.find(
            (unit) => unit.id === Number(reviewButton.dataset.dashboardReview),
          ),
        });
      const action = event.target.closest("[data-dashboard-action]")?.dataset
        .dashboardAction;
      if (action === "queue" || action === "validation")
        SBReview.open({
          unit: total,
          view: action === "validation" ? "validation" : "review",
        });
      if (action === "report") SBReport.download(total, data);
      if (action === "method") document.querySelector("#btn-method").click();
    });
    document.addEventListener("sar:review-updated", () => {
      if (document.body.dataset.experience === "dashboard") refresh();
    });
    return { refresh };
  }
  return { create, summarize };
})();
