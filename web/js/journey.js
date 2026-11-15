/* Presenter-paced investigation. All measurements and verdicts come from the export package. */
"use strict";
window.SBJourney = (() => {
  function create({ data, scene, select, fit, split, reducedMotion }) {
    const $ = (selector) => document.querySelector(selector);
    const escape = (value) =>
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
    const number = (value) =>
      Number.isFinite(value)
        ? value.toLocaleString("en-US", {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
          })
        : "n/a";
    const date = (value) =>
      new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
    const total = data.analysis.study_area;
    const featured =
      data.analysis.sectors.find((s) => s.id === 3) ||
      data.analysis.sectors.find((s) => s.conclusion.status === "supported") ||
      data.analysis.sectors[0];
    const sectorName = `Sector ${String(featured.id).padStart(2, "0")}`;
    const days = data.stats.days_between;
    const loss = total.detected_change.loss_ha;
    const gain = total.detected_change.gain_ha;
    const lossDominates = loss >= gain;
    const pair = total.detected_change.dates;
    const pairHTML = `<div class="journey-pair"><span>${date(pair[0])}</span><span aria-hidden="true">→</span><span>${date(pair[1])}</span></div>`;
    let mode = "intro",
      step = 0,
      applying = false,
      frame = 0,
      scrollTimer = 0,
      revision = 0;

    function stopMotion() {
      revision++;
      cancelAnimationFrame(frame);
      clearTimeout(scrollTimer);
      frame = 0;
    }
    function setViewURL(view) {
      const url = new URL(location.href);
      url.searchParams.set("view", view);
      history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
    function showScene(options) {
      applying = true;
      try {
        scene(options);
      } finally {
        applying = false;
      }
    }
    function setMode(value) {
      mode = value;
      document.body.dataset.experience =
        value === "guided" ? ["observe", "compare", "explain"][step] : value;
      $("#btn-tour").classList.toggle("active", value !== "workspace");
      $("#btn-tour").setAttribute(
        "aria-pressed",
        String(value !== "workspace"),
      );
      $("#btn-workspace").classList.toggle("active", value === "workspace");
      $("#btn-workspace").setAttribute(
        "aria-pressed",
        String(value === "workspace"),
      );
      $("#journey-controls").hidden = value !== "guided";
      $("#journey-panel-content").scrollTop = 0;
    }
    function focusStage() {
      const heading = $("#journey-panel h2");
      heading?.focus({ preventScroll: true });
      $("#journey-announcement").textContent =
        mode === "intro"
          ? "Guided investigation ready."
          : `Step ${step + 1} of 3. ${heading?.textContent || ""}`;
    }
    function fullWorkspace({ updateURL = true, restoreLayers = true } = {}) {
      stopMotion();
      setMode("workspace");
      if (restoreLayers)
        showScene({ compare: true, change: true, sectors: true });
      if (updateURL) setViewURL("workspace");
      requestAnimationFrame(() => fit({ animate: false, preserveView: true }));
    }
    function intro({ updateURL = true } = {}) {
      stopMotion();
      step = 0;
      setMode("intro");
      $("#journey-measure").textContent =
        `${number(lossDominates ? loss : gain)} hectares flagged by radar.`;
      $("#journey-question").textContent = `What changed in ${days} days?`;
      $("#journey-location").textContent =
        `Mingachevir Reservoir, Azerbaijan · ${date(pair[0])} — ${date(pair[1])}`;
      $("#journey-panel-content").innerHTML =
        `<h2 tabindex="-1">Follow the evidence.</h2>
        <p class="journey-lead">See what changed. Compare two radar observations. Investigate what might explain it.</p>
        <ol class="intro-sequence"><li><span class="sequence-number">01</span><div><h3>Observe</h3><p>Two NISAR radar acquisitions, ${days} days apart.</p></div></li><li><span class="sequence-number">02</span><div><h3>Compare</h3><p>Measure water loss and gain, sector by sector.</p></div></li><li><span class="sequence-number">03</span><div><h3>Explain</h3><p>Trace each hypothesis to independent evidence.</p></div></li></ol>
        <div class="pair-label">NISAR observation pair</div>${pairHTML}
        <button class="journey-primary intro-start" data-journey-action="start" type="button">Explore the change <span aria-hidden="true">→</span></button>
        <button class="journey-text-button" data-journey-action="workspace" type="button">Open full workspace</button>
        <p class="journey-footnote">A 60–90 second guided investigation. Advance at your own pace.</p>`;
      showScene({
        imagery: "S2",
        compare: false,
        change: false,
        sectors: false,
        outline: false,
        sector: null,
        position: 0.5,
      });
      if (updateURL) setViewURL("demo");
      requestAnimationFrame(() => fit({ animate: false }));
    }
    function animateComparison() {
      if (reducedMotion()) return;
      const start = performance.now();
      const tick = (now) => {
        if (mode !== "guided" || step !== 0) return;
        const progress = Math.min(1, (now - start) / 2400);
        split(0.5 - 0.26 * Math.sin(progress * Math.PI * 2));
        if (progress < 1) frame = requestAnimationFrame(tick);
        else {
          frame = 0;
          split(0.5);
        }
      };
      frame = requestAnimationFrame(tick);
    }
    function observationHTML() {
      return `<h2 tabindex="-1">Two dates.<br>One changing shoreline.</h2><p class="journey-lead">Move the divider to compare the same reservoir in two NISAR radar observations.</p>
        <div class="pair-label">Same track · same viewing geometry</div>${pairHTML}
        <dl class="journey-facts"><div><dt>Time between observations</dt><dd>${days} days</dd></div><div><dt>Radar polarisation</dt><dd>HH · L-band</dd></div><div><dt>Analysis grid</dt><dd>${data.stats.parameters.pixel_size_m} m</dd></div></dl>
        <div class="journey-insight"><span class="insight-number">01 / OBSERVE</span><h3>Look for the difference.</h3><p>The images are real radar observations. Their brightness represents backscatter, rather than visible colour.</p></div>
        <p class="journey-footnote">Provisional NISAR products. The next step adds the measured change layer.</p>`;
    }
    function comparisonHTML() {
      const valid = data.stats.totals.valid_fraction;
      return `<h2 tabindex="-1">The change has<br>a location.</h2><p class="journey-lead">The coloured overlay marks where the radar detected a land–water transition between the two dates.</p>
        <div class="story-measure"><span>Whole reservoir · NISAR HH</span><strong>${number(loss)}<small>ha water loss</small></strong><p>${number(gain)} ha water gain · ${(valid * 100).toFixed(2)}% valid coverage</p></div>
        <div class="story-legend"><span><i class="sw loss"></i>Water → land</span><span><i class="sw gain"></i>Land → water</span></div>
        <div class="journey-insight"><span class="insight-number">02 / COMPARE</span><h3>A measurement is the start.</h3><p>Radar identifies where a change occurred. It cannot determine the underlying cause on its own.</p></div>
        <p class="featured-invitation">Next: investigate <strong>${sectorName}</strong>, where ${number(featured.detected_change.loss_ha)} ha of radar-detected water became land.</p>
        <p class="journey-footnote">Whole-reservoir conclusion: ${escape(total.conclusion.label)}. Sector-level evidence can differ.</p>`;
    }
    function explanationHTML() {
      const hypothesis =
        featured.hypotheses.find((h) => h.id === "water_level") ||
        featured.hypotheses[0];
      const evidence = hypothesis?.evidence || [];
      const radar = evidence.filter((e) => e.source.startsWith("NISAR HH"));
      const radarPattern = radar.find((e) =>
        e.source.includes("spatial pattern"),
      );
      const radarPatternText = Number.isFinite(radarPattern?.value)
        ? `${Math.round(radarPattern.value * 100)}% of loss patches connect to land that stayed dry along the shoreline.`
        : "Inspect the radar observations supporting this measurement.";
      const optical = evidence.filter((e) => e.source.startsWith("Sentinel-2"));
      const opticalExtent = optical.find((e) => e.source.includes("extent"));
      const spatial = optical.find(
        (e) =>
          e.value &&
          typeof e.value === "object" &&
          Number.isFinite(e.value.within_40m),
      );
      const extent = opticalExtent?.value;
      const opticalSummary = Number.isFinite(extent)
        ? `${number(Math.abs(extent))} ha net ${extent < 0 ? "decrease" : "increase"} in optical water extent.`
        : "Independent optical evidence is unavailable.";
      const ledger = (items) =>
        `<ul class="chain-evidence">${items.map((e) => `<li><span class="chain-direction ${escape(e.direction)}">${escape(e.direction)}</span><p>${escape(e.statement)}</p><span class="chain-source">${escape(e.source)}</span></li>`).join("")}</ul>`;
      return `<h2 tabindex="-1">Why might the shoreline have changed?</h2><p class="journey-lead">${sectorName} · NISAR HH</p>
        <div class="chain-measure">${number(featured.detected_change.loss_ha)} <span>ha water loss</span></div>
        <div class="evidence-chain" aria-label="Trace the evidence for this sector">
          <details class="chain-item" name="evidence-chain" open><summary><span class="chain-number">01</span><span><strong>Radar observation</strong><small>${number(featured.detected_change.loss_ha)} ha changed from water to land.</small></span></summary><div class="chain-body"><p class="chain-brief">${escape(radarPatternText)}</p><span class="chain-source">NISAR HH · ${date(pair[0])} → ${date(pair[1])}</span><details class="chain-source-details"><summary>View original radar evidence</summary>${ledger(radar)}</details></div></details>
          <details class="chain-item" name="evidence-chain"><summary><span class="chain-number">02</span><span><strong>Independent optical check</strong><small>${opticalSummary}</small></span></summary><div class="chain-body">${spatial ? `<p class="chain-caution">${Math.round(spatial.value.within_40m * 100)}% of radar-loss pixels are within 40 m of optical shoreline retreat. This is partial spatial agreement.</p>` : ""}${ledger(optical)}</div></details>
          <details class="chain-item" name="evidence-chain"><summary><span class="chain-number">03</span><span><strong>Hypothesis assessment</strong><small class="chip ${escape(featured.conclusion.status)}">${escape(featured.conclusion.label)}</small></span></summary><div class="chain-body"><h3>${escape(hypothesis?.title || featured.conclusion.top_hypothesis)}</h3><p>${escape(featured.conclusion.status === "supported" ? "A consistent radar pattern and independent optical observations support this hypothesis." : featured.conclusion.reason)}</p><p class="chain-caution">Support for a hypothesis does not establish the underlying cause.</p></div></details>
        </div>
        <details class="chain-missing"><summary>What we still need</summary><p>Reservoir water-level and dam release records are unavailable.</p><ul>${featured.missing_evidence
          .filter((e) => /outflow|in-situ gauge|withdrawal records/.test(e))
          .map((e) => `<li>${escape(e)}</li>`)
          .join("")}</ul></details>
        <div class="journey-human-review"><span>Human review</span><strong data-human-status="sector-${featured.id}" class="human-state pending">Awaiting human review</strong><button type="button" class="journey-primary" data-review-open="review">Review this sector</button><button type="button" class="journey-text-button" data-review-open="validation">Inspect validation</button></div><div class="chain-actions"><button class="journey-text-button" type="button" data-journey-action="full-report">Open full sector report ↗</button><button class="journey-text-button" type="button" data-journey-action="overview">Compare the whole-reservoir verdict ↗</button></div>`;
    }
    function updateControls() {
      document.querySelectorAll("[data-step]").forEach((button) => {
        const current = Number(button.dataset.step) === step;
        button.classList.toggle("current", current);
        if (current) button.setAttribute("aria-current", "step");
        else button.removeAttribute("aria-current");
      });
      $("#btn-journey-next").innerHTML =
        `${["Show detected change", `Investigate ${sectorName}`, "Explore on your own"][step]} <span aria-hidden="true">→</span>`;
      $("#btn-journey-back").textContent = step === 0 ? "Overview" : "Back";
    }
    function go(index) {
      if (index < 0) {
        intro();
        focusStage();
        return;
      }
      if (index > 2) {
        fullWorkspace();
        $("#sector-select").focus({ preventScroll: true });
        if (window.innerWidth <= 900)
          $(".panel").scrollIntoView({
            behavior: reducedMotion() ? "auto" : "smooth",
            block: "start",
          });
        return;
      }
      stopMotion();
      step = index;
      setMode("guided");
      setViewURL("demo");
      $("#journey-measure").textContent = [
        "Look at the observations.",
        "Find the measured change.",
        "Follow the evidence.",
      ][step];
      $("#journey-question").textContent = [
        "What changed between two dates?",
        "Where did the water retreat?",
        "What might explain it?",
      ][step];
      $("#journey-location").textContent =
        step === 2
          ? `${sectorName} · Mingachevir Reservoir · Evidence-based interpretation`
          : `Mingachevir Reservoir · NISAR HH · ${date(pair[0])} — ${date(pair[1])}`;
      $("#journey-panel-content").innerHTML = [
        observationHTML,
        comparisonHTML,
        explanationHTML,
      ][step]();
      showScene({
        imagery: step === 2 ? "S2" : "HH",
        compare: step !== 2,
        change: step !== 0,
        sectors: step !== 0,
        outline: false,
        sector: step === 2 ? featured.id : null,
        position: 0.5,
      });
      SBReview.refreshBadges();
      updateControls();
      focusStage();
      const currentRevision = revision;
      requestAnimationFrame(() => {
        if (currentRevision !== revision || mode !== "guided") return;
        fit({ animate: step === 2 && !reducedMotion() });
        if (step === 0) animateComparison();
      });
      if (window.innerWidth <= 900) {
        scrollTimer = setTimeout(
          () =>
            (step === 2 ? $("#journey-panel") : $(".map-area")).scrollIntoView({
              behavior: reducedMotion() ? "auto" : "smooth",
              block: "start",
            }),
          step === 2 && !reducedMotion() ? 700 : 0,
        );
      }
    }
    $("#btn-tour").addEventListener("click", () => {
      intro();
      focusStage();
      window.scrollTo({
        top: 0,
        behavior: reducedMotion() ? "auto" : "smooth",
      });
    });
    $(".brand").addEventListener("click", (event) => {
      event.preventDefault();
      intro();
      focusStage();
      window.scrollTo({
        top: 0,
        behavior: reducedMotion() ? "auto" : "smooth",
      });
    });
    $("#btn-workspace").addEventListener("click", () => fullWorkspace());
    $("#btn-mobile-start").disabled = false;
    $("#btn-mobile-start").addEventListener("click", () => go(0));
    $("#btn-journey-next").addEventListener("click", () => go(step + 1));
    $("#btn-journey-back").addEventListener("click", () => go(step - 1));
    document
      .querySelectorAll("[data-step]")
      .forEach((button) =>
        button.addEventListener("click", () => go(Number(button.dataset.step))),
      );
    $("#journey-panel").addEventListener("click", (event) => {
      const action = event.target.closest("[data-journey-action]")?.dataset
        .journeyAction;
      if (action === "start") go(0);
      if (action === "workspace") fullWorkspace();
      if (action === "full-report") {
        fullWorkspace();
        $("#analysis-card .report-details").open = true;
        $(".panel").scrollIntoView({
          behavior: reducedMotion() ? "auto" : "smooth",
          block: "start",
        });
      }
      if (action === "overview") {
        fullWorkspace();
        select(null);
        $(".panel").scrollIntoView({
          behavior: reducedMotion() ? "auto" : "smooth",
          block: "start",
        });
      }
    });
    $("#divider .handle").addEventListener("pointerdown", stopMotion, {
      capture: true,
    });
    $("#divider .handle").addEventListener("keydown", stopMotion, {
      capture: true,
    });
    document.addEventListener("sar:sector-selected", () => {
      if (!applying && mode !== "workspace")
        fullWorkspace({ restoreLayers: false });
    });
    document.addEventListener("keydown", (event) => {
      if (
        mode !== "guided" ||
        !$("#method").hidden ||
        !$("#review-workspace").hidden ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.target.closest(
          "button, a, summary, input, select, textarea, [role=slider], [role=radio]",
        )
      )
        return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        go(step + 1);
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(step - 1);
      }
    });
    const fullscreenIcon =
      '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4"/></svg>';
    $("#btn-present").innerHTML = `Present ${fullscreenIcon}`;
    $("#btn-present").hidden = !document.fullscreenEnabled;
    $("#btn-present").addEventListener("click", async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
      } catch {
        $("#journey-announcement").textContent =
          "Fullscreen is unavailable in this browser. The guided investigation remains available.";
      }
    });
    document.addEventListener("fullscreenchange", () => {
      const active = Boolean(document.fullscreenElement);
      $("#btn-present").setAttribute("aria-pressed", String(active));
      $("#btn-present").innerHTML =
        `${active ? "Exit presentation" : "Present"} ${fullscreenIcon}`;
    });
    const workspaceRequested =
      new URL(location.href).searchParams.get("view") === "workspace" ||
      /^#(?:sector[-=]|method)/.test(location.hash);
    if (workspaceRequested)
      fullWorkspace({ updateURL: false, restoreLayers: false });
    else intro({ updateURL: false });
    return { intro, stopMotion };
  }
  return { create };
})();
