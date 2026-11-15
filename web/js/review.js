/* Human review UI and transparent optical-proxy comparison. */
"use strict";
window.SBReview = (() => {
  let api;
  function create({ data, activeUnit, selectSector }) {
    const $ = (selector) => document.querySelector(selector);
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
    const num = (value, decimals = 1) =>
      Number.isFinite(value)
        ? value.toLocaleString("en-US", {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
          })
        : "n/a";
    const pct = (value) =>
      value === null || value === undefined ? "n/a" : `${num(value * 100)}%`;
    const root = $("#review-workspace"),
      body = $("#review-body"),
      validation = data.validation;
    const units = [data.analysis.study_area, ...data.analysis.sectors];
    const unitKey = SBReviewStore.keyFor;
    const unitFor = (key) => units.find((unit) => unitKey(unit) === key);
    const proxyFor = (unit) =>
      unit.id === undefined
        ? validation.study_area
        : validation.sectors.find((item) => item.id === unit.id);
    const label = (unit) =>
      unit.id === undefined
        ? "Whole reservoir"
        : `Sector ${String(unit.id).padStart(2, "0")}`;
    let store,
      storageError = "",
      selected = "reservoir",
      tab = "review",
      opener;
    const drafts = new Map();
    try {
      store = SBReviewStore.create({ data, storage: window.localStorage });
    } catch {
      storageError =
        "Local review storage is unavailable or unreadable. Existing data was not overwritten. Reviews cannot be saved in this browser.";
    }
    const latest = (unit) => store?.latest(unitKey(unit));
    const reviewLabel = (unit) =>
      storageError
        ? "Storage unavailable"
        : latest(unit)
          ? SBReviewStore.outcomes[latest(unit).outcome]
          : "Awaiting human review";
    function download(text, filename, type = "application/json") {
      const url = URL.createObjectURL(new Blob([text], { type }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function announce(message, error = false) {
      const node = $("#review-message");
      node.textContent = message;
      node.classList.toggle("error", error);
      node.setAttribute("role", error ? "alert" : "status");
    }
    function saveDraft() {
      const form = $("#human-review-form");
      if (form) drafts.set(selected, Object.fromEntries(new FormData(form)));
    }
    function queueHTML() {
      const sectors = [...data.analysis.sectors].sort(
        (a, b) =>
          Number(b.significant_change) - Number(a.significant_change) ||
          b.detected_change.loss_ha - a.detected_change.loss_ha,
      );
      return `<nav class="review-queue" aria-label="Review analysis areas"><h3>Review queue</h3><p>Changed sectors first, then radar loss area. No hazard score.</p>${[
        data.analysis.study_area,
        ...sectors,
      ]
        .map((unit) => {
          const record = latest(unit);
          return `<button type="button" data-review-unit="${unitKey(unit)}" aria-pressed="${unitKey(unit) === selected}" class="review-queue-row"><span><strong>${label(unit)}</strong><b>${num(unit.detected_change.loss_ha)} ha</b></span><span class="review-queue-meta"><span>${esc(unit.conclusion.label)}</span><i class="human-state ${record?.outcome || "pending"}">${record ? esc(SBReviewStore.outcomes[record.outcome]) : "Pending"}</i></span></button>`;
        })
        .join("")}</nav>`;
    }
    function historyHTML(unit) {
      if (!store) return `<p class="review-muted">${esc(storageError)}</p>`;
      const current = store.current(unitKey(unit)).reverse();
      const older = store
        .all()
        .filter(
          (record) =>
            record.unit_key === unitKey(unit) &&
            record.package_id !== validation.package_id,
        ).length;
      const time = (iso) =>
        new Date(iso).toLocaleString("en-GB", {
          timeZone: "Asia/Baku",
          dateStyle: "medium",
          timeStyle: "short",
        });
      return `<div class="review-history"><h3>Review history</h3>${current.length ? current.map((record) => `<article><div><strong>${esc(record.reviewer)}</strong><span class="human-state ${record.outcome}">${esc(SBReviewStore.outcomes[record.outcome])}</span></div><p>${esc(record.rationale)}</p><p class="review-muted">Next action: ${esc(SBReviewStore.actions[record.next_action])}</p>${record.evidence_reference ? `<p class="review-reference">Evidence reference: ${esc(record.evidence_reference)}</p>` : ""}<small>${time(record.created_utc)} Baku · ${esc(record.id.slice(0, 8))}</small></article>`).join("") : '<p class="review-empty">No reviews recorded for this data version.</p>'}${older ? `<p class="review-version-note">${older} record(s) from earlier analysis packages are retained in the log and do not apply to this version.</p>` : ""}</div>`;
    }
    function editorHTML(unit) {
      const record = latest(unit),
        p = proxyFor(unit);
      const options = (object) =>
        Object.entries(object)
          .map(
            ([value, text]) => `<option value="${value}">${esc(text)}</option>`,
          )
          .join("");
      return `<section class="review-editor" aria-labelledby="review-unit-title"><div class="review-unit-title"><h3 id="review-unit-title">${label(unit)}</h3><span>${num(unit.detected_change.loss_ha)} ha <small>radar-indicated water loss</small></span></div>
        <div class="review-dual-status"><div><span>Evidence engine</span><strong class="chip ${esc(unit.conclusion.status)}">${esc(unit.conclusion.label)}</strong></div><div><span>Human review</span><strong class="human-state ${record?.outcome || "pending"}">${esc(reviewLabel(unit))}</strong></div></div>
        <p class="review-caution">A supported hypothesis is not an expert sign-off.${unit.significant_change && p.loss.f1 !== null && p.loss.f1 < 0.5 ? ` Pixel-wise loss overlap with the optical proxy is limited (F1 ${num(p.loss.f1, 3)}). Inspect the images and the comparison.` : ""}</p>
        <form id="human-review-form"><div class="review-form-grid"><label>Reviewer name<input name="reviewer" required minlength="2" maxlength="100" autocomplete="name" placeholder="Your name"></label><label>Review outcome<select name="outcome" required><option value="">Select outcome</option>${options(SBReviewStore.outcomes)}</select></label><label class="review-form-wide">Rationale<textarea name="rationale" required minlength="20" maxlength="2000" rows="3" placeholder="Describe the evidence you checked, uncertainties and the reason for your review outcome."></textarea></label><label><span>Evidence reference <small>(optional)</small></span><input name="evidence_reference" maxlength="500" placeholder="https://… or document ID"></label><label>Next action<select name="next_action" required><option value="">Select next action</option>${options(SBReviewStore.actions)}</select></label></div><div class="review-form-actions"><button type="submit" class="journey-primary" ${store ? "" : "disabled"}>Save review</button><button type="button" class="btn" data-review-action="export-log" ${store ? "" : "disabled"}>Export review log</button><button type="button" class="journey-text-button" data-review-action="open-map">Open area on map ↗</button></div><p class="review-muted">Next actions are recorded recommendations. No requests are sent to an agency or operator.</p></form>
        ${historyHTML(unit)}<p class="review-identity-note">Reviewer names are self-reported. This local demo does not authenticate identities or issue scientific sign-offs.</p></section>`;
    }
    function comparisonHTML(unit) {
      const p = proxyFor(unit);
      const referenceDates = validation.optical_scenes;
      return `<section class="review-validation" aria-labelledby="validation-unit-title"><h3 id="validation-unit-title">${label(unit)} · optical-proxy comparison</h3><p class="review-lead">Pixel-wise comparison of NISAR change with cloud-masked Sentinel-2 change. These are sensor-agreement metrics, not ground-truth accuracy.</p>
        <div class="validation-context"><div><span>Common-valid comparison area</span><strong>${num(p.common_valid_ha)} ha</strong></div><div><span>Excluded from comparison</span><strong>${num(p.excluded_from_comparison_ha)} ha</strong></div><div><span>After water-mask agreement</span><strong>${pct(p.after_water_mask_agreement)}</strong></div></div>
        <p class="review-caution">Stable water and land dominate overall agreement. It must not be reported as change-detection accuracy or AI confidence.</p>
        <div class="review-table-scroll"><table class="validation-table"><caption>Class-specific metrics against the optical proxy</caption><thead><tr><th>Change class</th><th>Precision</th><th>Recall</th><th>F1</th><th>IoU</th></tr></thead><tbody>${["loss", "gain"].map((kind) => `<tr><th>Water ${kind}</th><td>${pct(p[kind].precision)}</td><td>${pct(p[kind].recall)}</td><td>${num(p[kind].f1, 3)}</td><td>${num(p[kind].iou, 3)}</td></tr>`).join("")}</tbody></table></div>
        <div class="review-table-scroll"><table class="validation-table"><caption>Comparison counts · pixels on the common-valid ${validation.method.grid_m} m grid</caption><thead><tr><th>Change class</th><th>Overlap (TP)</th><th>Radar only (FP)</th><th>Optical only (FN)</th><th>Neither (TN)</th></tr></thead><tbody>${["loss", "gain"].map((kind) => `<tr><th>Water ${kind}</th>${["tp_px", "fp_px", "fn_px", "tn_px"].map((key) => `<td>${num(p[kind][key], 0)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
        <p class="review-muted">Precision = TP / (TP + FP); recall = TP / (TP + FN); F1 = 2TP / (2TP + FP + FN); IoU = TP / (TP + FP + FN). “n/a” means an empty denominator. FP and FN are disagreements with the proxy, not field-confirmed errors.</p>
        <details class="validation-provenance" open><summary>Dates, method &amp; limitations</summary><dl><dt>NISAR</dt><dd>${validation.radar_dates.map(esc).join(" → ")}</dd><dt>Sentinel-2</dt><dd>${esc(referenceDates.before.datetime_utc)} → ${esc(referenceDates.after.datetime_utc)}</dd></dl><ul>${validation.limitations.map((text) => `<li>${esc(text)}</li>`).join("")}</ul></details>
        <div class="validation-unavailable"><strong>Field validation: not yet available</strong><p>No independently labelled field dataset has been used. Human review records do not automatically become ground truth.</p></div>
        <button class="btn" type="button" data-review-action="export-comparison">Export comparison JSON</button></section>`;
    }
    function revealSelectedQueueItem() {
      if (root.hidden || !matchMedia("(max-width: 900px)").matches) return;
      const queue = root.querySelector(".review-queue");
      const selectedButton = queue.querySelector('[aria-pressed="true"]');
      queue.scrollLeft = selectedButton.offsetLeft - queue.offsetLeft - 10;
    }
    function render() {
      const unit = unitFor(selected);
      body.innerHTML = `${queueHTML()}${tab === "review" ? editorHTML(unit) : comparisonHTML(unit)}`;
      document.querySelectorAll("[data-review-tab]").forEach((button) => {
        const active = button.dataset.reviewTab === tab;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      $("#review-package").textContent =
        `Package ${validation.package_id.slice(0, 12)} · NISAR ${validation.radar_dates.join(" → ")}`;
      revealSelectedQueueItem();
      const form = $("#human-review-form");
      if (form) {
        const draft = drafts.get(selected);
        if (draft)
          for (const [key, value] of Object.entries(draft))
            if (form.elements.namedItem(key))
              form.elements.namedItem(key).value = value;
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          try {
            if (!store) throw new Error(storageError);
            store.save({
              unit_key: selected,
              ...Object.fromEntries(new FormData(form)),
            });
            drafts.delete(selected);
            render();
            refreshBadges();
            announce(
              "Review saved on this browser. The evidence-engine verdict is unchanged.",
            );
          } catch (error) {
            announce(
              error.message ||
                "The review could not be saved. Existing records were kept.",
              true,
            );
          }
        });
      }
    }
    function refreshBadges() {
      document.querySelectorAll("[data-human-status]").forEach((node) => {
        const unit = unitFor(node.dataset.humanStatus);
        if (unit) {
          node.textContent = reviewLabel(unit);
          node.className = `human-state ${latest(unit)?.outcome || "pending"}`;
        }
      });
    }
    function open({ unit = activeUnit(), view = "review" } = {}) {
      selected = unitKey(unit);
      tab = view;
      opener = document.activeElement;
      render();
      root.hidden = false;
      revealSelectedQueueItem();
      $("#workspace").inert = true;
      $(".topbar").inert = true;
      document.body.style.overflow = "hidden";
      $("#review-close").focus();
      announce(
        storageError ||
          "Review names and decisions are self-reported and saved locally.",
        Boolean(storageError),
      );
    }
    function close() {
      saveDraft();
      root.hidden = true;
      $("#workspace").inert = false;
      $(".topbar").inert = false;
      document.body.style.overflow = "";
      if (opener?.isConnected && opener.getClientRects().length) opener.focus();
      else $("#btn-review").focus();
    }
    $("#btn-review").disabled = false;
    $("#btn-review").addEventListener("click", () => open());
    $("#review-close").addEventListener("click", close);
    root.addEventListener("click", (event) => {
      if (event.target === root) {
        close();
        return;
      }
      const queue = event.target.closest("[data-review-unit]");
      if (queue) {
        saveDraft();
        selected = queue.dataset.reviewUnit;
        render();
        announce("");
      }
      const action = event.target.closest("[data-review-action]")?.dataset
        .reviewAction;
      if (action === "export-log" && store)
        download(store.export(), "SAR-BRIDGE-local-review-log.json");
      if (action === "export-comparison")
        download(
          JSON.stringify(
            {
              package_id: validation.package_id,
              reference_type: validation.reference_type,
              ground_truth_validated: false,
              method: validation.method,
              radar_dates: validation.radar_dates,
              optical_scenes: validation.optical_scenes,
              comparison: proxyFor(unitFor(selected)),
              limitations: validation.limitations,
            },
            null,
            2,
          ),
          `SAR-BRIDGE-${selected}-optical-comparison.json`,
        );
      if (action === "open-map") {
        const unit = unitFor(selected);
        close();
        $("#btn-workspace").click();
        selectSector(unit.id ?? null);
      }
    });
    document.querySelectorAll("[data-review-tab]").forEach((button) =>
      button.addEventListener("click", () => {
        saveDraft();
        tab = button.dataset.reviewTab;
        render();
        announce("");
      }),
    );
    $("#review-import").addEventListener("change", async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      try {
        if (!store) throw new Error(storageError);
        if (file.size > 2_000_000)
          throw new Error("Choose a review log smaller than 2 MB.");
        saveDraft();
        const added = store.import(await file.text());
        render();
        refreshBadges();
        announce(
          `${added} record(s) imported. Reviewer identities are not authenticated; earlier-package records do not apply to this version.`,
        );
      } catch (error) {
        announce(error.message, true);
      }
      event.target.value = "";
    });
    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-review-open]");
      if (button)
        open({
          view:
            button.dataset.reviewOpen === "validation"
              ? "validation"
              : "review",
        });
    });
    document.addEventListener("keydown", (event) => {
      if (root.hidden) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
      if (event.key === "Tab") {
        const focusable = [
          ...root.querySelectorAll(
            "button:not(:disabled),input:not(:disabled),select,textarea,summary,[tabindex='0']",
          ),
        ].filter((node) => node.getClientRects().length);
        if (event.shiftKey && document.activeElement === focusable[0]) {
          event.preventDefault();
          focusable.at(-1).focus();
        } else if (
          !event.shiftKey &&
          document.activeElement === focusable.at(-1)
        ) {
          event.preventDefault();
          focusable[0].focus();
        }
      }
    });
    api = {
      open,
      close,
      refreshBadges,
      reviewLabel,
      reportFor(unit) {
        return {
          package_id: validation.package_id,
          storage_scope: "local_browser_demo",
          identity_verified: false,
          storage_available: Boolean(store),
          records: store?.current(unitKey(unit)) || [],
        };
      },
    };
    refreshBadges();
    return api;
  }
  return {
    create,
    open(options) {
      api?.open(options);
    },
    refreshBadges() {
      api?.refreshBadges();
    },
    reportFor(unit) {
      return api?.reportFor(unit);
    },
  };
})();
