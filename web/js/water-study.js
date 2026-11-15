/* Local, source-linked optical investigations; independent of the NISAR pilot. */
"use strict";
window.SBWaterStudy = (() => {
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
  const num = (value, digits = 1) =>
    Number.isFinite(value)
      ? value.toLocaleString("en-US", {
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
  const period = (observation) =>
    observation.start_date === observation.end_date
      ? date(observation.start_date)
      : `${date(observation.start_date)} – ${date(observation.end_date)}`;
  function validate(study, expectedId, expectedPackage) {
    if (
      !study ||
      study.schema_version !== 1 ||
      study.id !== expectedId ||
      !/^[a-z][a-z0-9-]*$/.test(study.id) ||
      study.analysis_type !== "optical_water_change" ||
      study.sensor !== "Sentinel-2 L2A" ||
      !/^[a-f0-9]{64}$/.test(study.package_id) ||
      (expectedPackage && study.package_id !== expectedPackage)
    )
      throw new Error(
        "The selected water study is missing or belongs to another export.",
      );
    if (
      !Number.isFinite(study.grid_m) ||
      study.grid_m < 10 ||
      !Array.isArray(study.bounds) ||
      study.bounds.length !== 2 ||
      study.bounds.some((p) => p.length !== 2 || !p.every(Number.isFinite)) ||
      study.bounds[0][0] >= study.bounds[1][0] ||
      study.bounds[0][1] >= study.bounds[1][1]
    )
      throw new Error("Invalid analysis grid or image bounds.");
    if (
      !Array.isArray(study.sectors) ||
      !study.sectors.length ||
      new Set(study.sectors.map((s) => s.id)).size !== study.sectors.length ||
      study.sector_geojson?.features?.length !== study.sectors.length ||
      new Set(study.sector_geojson.features.map((f) => f.properties.id))
        .size !== study.sectors.length ||
      study.sector_geojson.features.some(
        (f) => !study.sectors.some((s) => s.id === f.properties.id),
      )
    )
      throw new Error("The study sectors and map geometry differ.");
    for (const unit of [study.totals, ...study.sectors]) {
      if (
        !unit ||
        ![
          "loss_ha",
          "gain_ha",
          "water_before_ha",
          "water_after_ha",
          "valid_area_ha",
          "zone_area_ha",
          "valid_fraction",
        ].every((key) => Number.isFinite(unit[key]) && unit[key] >= 0) ||
        unit.valid_fraction > 1 ||
        unit.valid_area_ha > unit.zone_area_ha + 0.02 ||
        unit.water_before_ha > unit.valid_area_ha + 0.02 ||
        unit.water_after_ha > unit.valid_area_ha + 0.02 ||
        unit.loss_ha > unit.water_before_ha + 0.02 ||
        unit.gain_ha > unit.water_after_ha + 0.02 ||
        (unit.zone_area_ha > 0 &&
          Math.abs(
            unit.valid_fraction - unit.valid_area_ha / unit.zone_area_ha,
          ) >
            0.02 / unit.zone_area_ha + 0.000001) ||
        Math.abs(
          unit.water_after_ha -
            unit.water_before_ha -
            (unit.gain_ha - unit.loss_ha),
        ) > 0.04
      )
        throw new Error("Inconsistent water-area measurements.");
    }
    for (const key of [
      "loss_ha",
      "gain_ha",
      "water_before_ha",
      "water_after_ha",
      "valid_area_ha",
      "zone_area_ha",
    ])
      if (
        Math.abs(
          study.sectors.reduce((sum, s) => sum + s[key], 0) - study.totals[key],
        ) > 0.12
      )
        throw new Error("Sector totals do not match the study area.");
    for (const side of ["before", "after"]) {
      const obs = study.observations?.[side];
      if (
        !obs?.scenes?.length ||
        !Number.isFinite(Date.parse(obs.start_date)) ||
        !Number.isFinite(Date.parse(obs.end_date)) ||
        Date.parse(obs.end_date) < Date.parse(obs.start_date) ||
        Date.parse(obs.end_date) - Date.parse(obs.start_date) > 6 * 86400000 ||
        obs.scenes.some(
          (s) =>
            !s.id ||
            s.datetime_utc.slice(0, 10) < obs.start_date ||
            s.datetime_utc.slice(0, 10) > obs.end_date ||
            !s.stac_url?.startsWith("https://earth-search.aws.element84.com/"),
        )
      )
        throw new Error("Invalid observation dates or source scenes.");
    }
    if (
      study.observations.before.end_date >= study.observations.after.start_date
    )
      throw new Error("Observation windows are not ordered.");
    for (const key of ["before", "after", "change"])
      if (study.assets?.[key] !== `data/water-studies/${study.id}/${key}.webp`)
        throw new Error("Unexpected study image path.");
    if (!study.sources?.length || !study.limitations?.length)
      throw new Error("Study provenance is missing.");
    return study;
  }
  function markdown(study, sectorId = null) {
    const unit =
      sectorId === null
        ? study.totals
        : study.sectors.find((s) => s.id === sectorId);
    if (!unit) throw new Error("Unknown study sector.");
    return [
      `# SAR-BRIDGE / ${study.name}`,
      "",
      `Area: ${sectorId === null ? "Whole study area" : unit.name}`,
      `Sensor: ${study.sensor} (optical)`,
      `Before: ${period(study.observations.before)}`,
      `After: ${period(study.observations.after)}`,
      `Grid: ${study.grid_m} m`,
      `Package: ${study.package_id}`,
      "",
      "## Measured water-surface change",
      "",
      `- Water loss: ${unit.loss_ha} ha`,
      `- Water gain: ${unit.gain_ha} ha`,
      `- Net change: ${num(unit.gain_ha - unit.loss_ha, 2)} ha`,
      `- Before water area: ${unit.water_before_ha} ha`,
      `- After water area: ${unit.water_after_ha} ha`,
      `- Common-valid coverage: ${num(unit.valid_fraction * 100)}%`,
      "",
      "Areas use only pixels valid in both observation windows. Water area is not water volume.",
      "",
      "## Method",
      "",
      study.method.water_index,
      `Cloud/shadow/snow exclusions: SCL ${study.method.invalid_scl_classes.join(", ")}.`,
      `OSM outline + ${study.method.outline_buffer_m} m buffer; ${study.grid_m} m local UTM grid.`,
      `Sector order: ${study.method.sector_order}.`,
      "",
      "## Observation provenance",
      "",
      ...["before", "after"].flatMap((side) =>
        study.observations[side].scenes.flatMap((s) => [
          `- ${side}: ${s.id} / ${s.datetime_utc}`,
          `  ${s.stac_url}`,
        ]),
      ),
      "",
      "## Sources",
      "",
      ...study.sources.map((s) => `- ${s.name}: ${s.url}`),
      "",
      "## Missing evidence",
      "",
      "- In-situ water-level measurements",
      "- Reservoir operation and dam-release records",
      "- Independent shoreline validation and a longer time series",
      "",
      "## Limitations",
      "",
      ...study.limitations.map((s) => `- ${s}`),
      "",
    ].join("\n");
  }
  function create({ getMap, onClose }) {
    const $ = (s) => document.querySelector(s);
    const detail = $("#atlas-detail"),
      wrap = $(".atlas-map-wrap"),
      column = $(".atlas-map-column");
    const summary = document.createElement("section");
    summary.className = "water-study-summary";
    summary.hidden = true;
    column.prepend(summary);
    const ui = document.createElement("div");
    ui.className = "water-study-map-ui";
    ui.hidden = true;
    wrap.append(ui);
    let study,
      selected = null,
      revision = 0,
      split = 0.5,
      imageLayers = [],
      sectors,
      sectorLabels,
      selectedLayer,
      fetchController,
      busy = false;
    const cache = new Map();
    const drafts = new Map();
    let reviewStore, reviewStorageError;
    try {
      reviewStore = SBWaterReviews.create({ storage: window.localStorage });
    } catch {
      reviewStorageError = "Review storage is unavailable in this browser.";
    }
    function reviewState() {
      try {
        if (!reviewStore) throw new Error(reviewStorageError);
        return { records: reviewStore.read(study, selected), error: null };
      } catch (error) {
        return { records: [], error: error.message };
      }
    }
    function saveDraft() {
      const form = $("#water-review-form");
      if (!study || !form) return;
      drafts.set(SBWaterReviews.keyFor(study, selected), {
        fields: Object.fromEntries(new FormData(form)),
        open: form.closest("details").open,
      });
    }
    function setURL(active) {
      const url = new URL(location.href);
      if (active) url.searchParams.set("analysis", "1");
      else url.searchParams.delete("analysis");
      if (active && selected !== null)
        url.searchParams.set("water-sector", selected);
      else url.searchParams.delete("water-sector");
      history.replaceState(null, "", url.pathname + url.search);
    }
    function clearLayers() {
      const map = getMap();
      if (map) {
        imageLayers.forEach((layer) => map.removeLayer(layer));
        if (sectors) map.removeLayer(sectors);
        if (sectorLabels) map.removeLayer(sectorLabels);
        if (selectedLayer) map.removeLayer(selectedLayer);
        map.off("move zoom resize", clip);
        if (map.getPane("optical-before"))
          map.getPane("optical-before").style.clip = "";
        if (map.getPane("optical-after"))
          map.getPane("optical-after").style.clip = "";
      }
      imageLayers = [];
      sectors = sectorLabels = selectedLayer = null;
    }
    function close({ updateURL = true } = {}) {
      saveDraft();
      revision++;
      fetchController?.abort();
      fetchController = null;
      clearLayers();
      study = null;
      busy = false;
      selected = null;
      ui.hidden = summary.hidden = true;
      wrap.classList.remove("has-water-study");
      detail.classList.remove("water-study-detail");
      if (updateURL) setURL(false);
    }
    function clip() {
      if (!study || imageLayers.length < 2) return;
      const map = getMap(),
        size = map.getSize();
      const a = map.containerPointToLayerPoint([0, 0]),
        b = map.containerPointToLayerPoint(size),
        x = a.x + size.x * split;
      map.getPane("optical-before").style.clip =
        `rect(${a.y}px,${x}px,${b.y}px,${a.x}px)`;
      map.getPane("optical-after").style.clip =
        `rect(${a.y}px,${b.x}px,${b.y}px,${x}px)`;
      const line = ui.querySelector(".water-study-divider");
      if (line) line.style.left = `${split * 100}%`;
    }
    function scope() {
      return selected === null
        ? study.totals
        : study.sectors.find((s) => s.id === selected);
    }
    function renderSummary() {
      const t = scope(),
        net = t.gain_ha - t.loss_ha;
      summary.innerHTML = `<div><span>Optical water loss</span><strong class="water-loss">${num(t.loss_ha)}<small> ha</small></strong></div><div><span>Optical water gain</span><strong class="water-gain">${num(t.gain_ha)}<small> ha</small></strong></div><div><span>Net surface-area change</span><strong>${net > 0 ? "+" : ""}${num(net)}<small> ha</small></strong></div><div><span>Usable on both dates</span><strong>${num(t.valid_fraction * 100)}<small>%</small></strong></div>`;
    }
    function renderReport() {
      const t = scope(),
        net = t.gain_ha - t.loss_ha;
      const enough = t.valid_fraction >= 0.65;
      const description = !enough
        ? "This sector has limited common-valid observations. Inspect the missing-data areas before interpreting a water-surface difference."
        : Math.abs(net) < study.grid_m ** 2 / 10000
          ? "The net water-area difference is below one analysis pixel. Local gains and losses may still be present."
          : `Within the common-valid study area, mapped water ${net < 0 ? "decreased" : "increased"} by ${num(Math.abs(net))} hectares. Optical images identify a surface-area difference; they do not establish its cause.`;
      const max = Math.max(
        1,
        ...study.sectors.flatMap((s) => [s.loss_ha, s.gain_ha]),
      );
      detail.classList.add("water-study-detail");
      detail.innerHTML = `<div class="water-study-report-head"><div><p class="eyebrow">OPTICAL INVESTIGATION / ${study.grid_m} M GRID</p><h2>${esc(study.name)}</h2><p>${esc(study.country)} · ${esc(study.sensor)}</p></div><div class="water-study-actions"><button type="button" class="btn" data-water-action="export">Export report ↓</button><button type="button" class="journey-text-button" data-water-action="close">Back to satellite context</button></div></div>
        <div class="water-study-dates"><div><span>BEFORE OBSERVATION</span><strong>${esc(period(study.observations.before))}</strong><small>${study.observations.before.scenes.length} source scene(s)</small></div><span aria-hidden="true">→</span><div><span>AFTER OBSERVATION</span><strong>${esc(period(study.observations.after))}</strong><small>${study.observations.after.scenes.length} source scene(s)</small></div></div>
        <div class="water-study-report-grid"><section aria-labelledby="water-findings-title"><div class="water-study-scope"><label for="water-study-sector">Analysis area</label><select id="water-study-sector"><option value="all">Whole study area</option>${study.sectors.map((s) => `<option value="${s.id}" ${selected === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div><h3 id="water-findings-title">${selected === null ? "Whole study area" : esc(t.name)}</h3><p class="water-study-finding">${esc(description)}</p><dl class="water-study-areas"><div><dt>Water before</dt><dd>${num(t.water_before_ha)} ha</dd></div><div><dt>Water after</dt><dd>${num(t.water_after_ha)} ha</dd></div></dl><p class="water-study-scope-note">Common-valid pixels only · OSM outline + ${study.method.outline_buffer_m} m buffer · ${study.method.sector_order} sectors</p><details class="water-study-evidence"><summary>How the measurement was made</summary><ol><li>Load the listed Copernicus Sentinel-2 L2A observations.</li><li>Exclude cloud, cloud-shadow, snow and missing pixels using the scene-classification layer.</li><li>Identify water using NDWI &gt; 0; remove water patches smaller than 1 ha.</li><li>Compare water/land classifications on the common-valid ${study.grid_m} m grid and count pixel areas.</li></ol><p>This optical investigation has not been evaluated against independent labels. No F1, precision or recall is assigned to it.</p></details><details class="water-study-evidence"><summary>What might explain the difference?</summary><p>Water-level variation, reservoir operations, rainfall and evaporation are possible drivers. Image classification, remaining cloud/shadow and shoreline mixing can also contribute. These observations alone cannot distinguish the cause.</p><p>Next evidence to check: gauge measurements, reservoir release records, weather observations and an independent shoreline reference.</p></details><details class="water-study-evidence"><summary>Sources, dates &amp; limitations</summary>${["before", "after"].map((side) => `<h4>${side === "before" ? "Before" : "After"} source scenes</h4><ul>${study.observations[side].scenes.map((s) => `<li><a href="${esc(s.stac_url)}" target="_blank" rel="noopener noreferrer">${esc(s.id)} ↗</a><small>${esc(s.datetime_utc)} · scene cloud ${num(s.scene_cloud_cover_pct)}%</small></li>`).join("")}</ul>`).join("")}<ul>${study.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)} ↗</a></li>`).join("")}</ul><ul>${study.limitations.map((s) => `<li>${esc(s)}</li>`).join("")}</ul><p>Package ${esc(study.package_id.slice(0, 12))}</p></details><details class="water-study-evidence"><summary>Record a human review</summary><p>Local browser record for this area and data package. Names are self-reported.</p><form id="water-review-form"><label>Reviewer name<input name="reviewer" required minlength="2" maxlength="100" autocomplete="name"></label><label>Assessment<select name="outcome" required><option value="">Select assessment</option><option value="reviewed">Reviewed</option><option value="needs_data">More evidence needed</option><option value="disputed">Interpretation disputed</option></select></label><label class="water-review-rationale">Rationale<textarea name="rationale" required minlength="20" maxlength="2000" rows="3" placeholder="What did you check, and what evidence is still needed?"></textarea></label><button class="journey-primary" type="submit">Save review</button></form><p id="water-review-message" role="status"></p></details></section><section class="water-study-sector-chart" aria-labelledby="water-chart-title"><h3 id="water-chart-title">Where did water change?</h3><p>Click a sector to inspect it · hectares</p><div class="water-study-chart-legend"><span><i class="water-loss-swatch"></i>Loss</span><span><i class="water-gain-swatch"></i>Gain</span></div>${study.sectors.map((s) => `<button type="button" class="water-study-sector-row" data-water-sector="${s.id}" aria-pressed="${selected === s.id}"><strong>${esc(s.name)}</strong><span class="water-study-bar-pair"><i class="water-loss-bar" style="width:${(s.loss_ha / max) * 100}%"></i><i class="water-gain-bar" style="width:${(s.gain_ha / max) * 100}%"></i></span><span>${num(s.loss_ha)} / ${num(s.gain_ha)}</span></button>`).join("")}<p class="water-study-scope-note">Geographic strips through the buffered outline; not administrative zones or a hazard ranking.</p></section></div>`;
      $("#water-study-sector").addEventListener("change", (event) =>
        select(
          event.target.value === "all" ? null : Number(event.target.value),
        ),
      );
      $("#water-review-form").addEventListener("submit", saveReview);
      const form = $("#water-review-form");
      const draft = drafts.get(SBWaterReviews.keyFor(study, selected));
      if (draft) {
        for (const [name, value] of Object.entries(draft.fields)) {
          const control = form.elements.namedItem(name);
          if (control) control.value = value;
        }
        form.closest("details").open = draft.open;
      }
      const history = document.createElement("div");
      history.id = "water-review-history";
      history.className = "water-review-history";
      $("#water-review-message").after(history);
      renderReviewHistory();
    }
    function renderReviewHistory() {
      const state = reviewState(),
        history = $("#water-review-history");
      const form = $("#water-review-form"),
        disclosure = form.closest("details");
      disclosure.querySelector("summary").textContent =
        `Human review · ${state.error ? "storage unavailable" : state.records.length ? `${state.records.length} recorded` : "pending"}`;
      form.querySelector('button[type="submit"]').disabled = Boolean(
        state.error,
      );
      if (state.error) {
        history.innerHTML = `<p class="water-review-storage-error" role="alert">${esc(state.error)} Existing records were not overwritten.</p>`;
        return;
      }
      history.innerHTML = `<h4>Review history</h4>${
        state.records.length
          ? [...state.records]
              .reverse()
              .map(
                (record) =>
                  `<article><div><strong>${esc(record.reviewer)}</strong><span>${esc(SBWaterReviews.outcomes[record.outcome])}</span></div><p>${esc(record.rationale)}</p><small>${esc(new Date(record.created_utc).toLocaleString("en-GB", { timeZone: "Asia/Baku", dateStyle: "medium", timeStyle: "short" }))} Baku</small></article>`,
              )
              .join("")
          : "<p>No reviews recorded for this area and data version.</p>"
      }`;
    }
    function select(id) {
      if (id !== null && !study.sectors.some((s) => s.id === id)) return;
      saveDraft();
      selected = id;
      const map = getMap();
      if (selectedLayer) map.removeLayer(selectedLayer);
      selectedLayer = null;
      if (id !== null) {
        const feature = study.sector_geojson.features.find(
          (f) => f.properties.id === id,
        );
        selectedLayer = L.geoJSON(feature, {
          pane: "optical-sectors",
          style: { color: "#f2c58d", weight: 3, fillOpacity: 0.06 },
          interactive: false,
        }).addTo(map);
        map.fitBounds(selectedLayer.getBounds(), {
          padding: [35, 35],
          maxZoom: 13,
          animate: false,
        });
      } else map.fitBounds(study.bounds, { padding: [12, 12], animate: false });
      renderSummary();
      renderReport();
      setURL(true);
    }
    function saveReview(event) {
      event.preventDefault();
      const message = $("#water-review-message");
      const fields = Object.fromEntries(new FormData(event.currentTarget));
      try {
        if (!reviewStore) throw new Error(reviewStorageError);
        reviewStore.save(study, selected, fields);
        drafts.delete(SBWaterReviews.keyFor(study, selected));
        message.textContent = `Review saved in this browser for ${selected === null ? "the whole study area" : scope().name}.`;
        event.currentTarget.reset();
        renderReviewHistory();
      } catch (error) {
        message.textContent = `Review could not be saved. ${error.message}`;
      }
    }
    async function open(entry) {
      close({ updateURL: false });
      const ticket = revision;
      busy = true;
      detail.innerHTML =
        '<div class="water-study-loading" role="status">Opening the dated observations and water-change measurements…</div>';
      try {
        let result = cache.get(entry.id);
        if (!result) {
          const controller = new AbortController();
          fetchController = controller;
          const timeout = setTimeout(() => controller.abort(), 30000);
          try {
            const response = await fetch(entry.analysis_url, {
              cache: "no-cache",
              signal: controller.signal,
            });
            if (!response.ok)
              throw new Error(
                `Study data unavailable (HTTP ${response.status}).`,
              );
            result = validate(
              await response.json(),
              entry.id,
              entry.package_id,
            );
            cache.set(entry.id, result);
          } finally {
            clearTimeout(timeout);
            if (fetchController === controller) fetchController = null;
          }
        }
        if (ticket !== revision) return;
        study = result;
        busy = false;
        const map = getMap();
        for (const [name, z] of [
          ["optical-before", 410],
          ["optical-after", 411],
          ["optical-change", 420],
          ["optical-sectors", 450],
        ]) {
          const pane = map.getPane(name) || map.createPane(name);
          pane.style.zIndex = z;
          pane.style.pointerEvents =
            name === "optical-sectors" ? "auto" : "none";
        }
        imageLayers = ["before", "after", "change"].map((side) =>
          L.imageOverlay(study.assets[side], study.bounds, {
            pane: side === "change" ? "optical-change" : `optical-${side}`,
            interactive: false,
            attribution:
              "Sentinel-2 © ESA Copernicus · OSM water outline © OpenStreetMap contributors",
          }).addTo(map),
        );
        imageLayers.forEach((layer) =>
          layer.on("error", () => {
            if (ticket === revision && study) {
              const node = ui.querySelector(".water-study-image-status");
              if (node)
                node.textContent =
                  "An observation image could not load. Reopen this study to retry.";
            }
          }),
        );
        sectorLabels = L.layerGroup().addTo(map);
        sectors = L.geoJSON(study.sector_geojson, {
          pane: "optical-sectors",
          style: {
            color: "#dce9e1",
            weight: 1,
            dashArray: "5 5",
            fillOpacity: 0,
          },
          onEachFeature(feature, layer) {
            layer.bindTooltip(esc(feature.properties.name));
            layer.on("click", () => select(feature.properties.id));
            L.marker(layer.getBounds().getCenter(), {
              icon: L.divIcon({
                className: "optical-sector-tag",
                html: `<span>${String(feature.properties.id).padStart(2, "0")}</span>`,
                iconSize: [25, 23],
                iconAnchor: [12, 11],
              }),
              title: feature.properties.name,
              alt: feature.properties.name,
            })
              .on("click", () => select(feature.properties.id))
              .addTo(sectorLabels);
          },
        }).addTo(map);
        ui.innerHTML = `<div class="water-study-map-toolbar"><span>Sentinel-2 · ${study.grid_m} m</span><label><input id="water-show-change" type="checkbox" checked> Water change</label><label><input id="water-show-sectors" type="checkbox" checked> Sectors</label></div><span class="water-study-flag before">BEFORE · ${esc(period(study.observations.before))}</span><span class="water-study-flag after">AFTER · ${esc(period(study.observations.after))}</span><div class="water-study-divider" aria-hidden="true"><span>↔</span></div><div class="water-study-map-bottom"><label for="water-study-split">Compare observations<input id="water-study-split" type="range" min="0" max="100" value="50" aria-label="Before and after image divider"></label><div><span><i class="water-loss-swatch"></i>Water loss</span><span><i class="water-gain-swatch"></i>Water gain</span><span>Hatching: no common-valid data</span></div></div><span class="water-study-image-status" role="status"></span>`;
        ui.hidden = summary.hidden = false;
        wrap.classList.add("has-water-study");
        $("#water-study-split").addEventListener("input", (event) => {
          split = Number(event.target.value) / 100;
          clip();
        });
        $("#water-show-change").addEventListener("change", (event) => {
          if (event.target.checked) imageLayers[2].addTo(map);
          else map.removeLayer(imageLayers[2]);
        });
        $("#water-show-sectors").addEventListener("change", (event) => {
          if (event.target.checked) {
            sectors.addTo(map);
            sectorLabels.addTo(map);
          } else {
            map.removeLayer(sectors);
            map.removeLayer(sectorLabels);
          }
        });
        map.on("move zoom resize", clip);
        split = 0.5;
        const sectorParam = new URL(location.href).searchParams.get(
          "water-sector",
        );
        select(
          sectorParam !== null &&
            study.sectors.some((s) => s.id === Number(sectorParam))
            ? Number(sectorParam)
            : null,
        );
        map.invalidateSize({ pan: false });
        clip();
      } catch (error) {
        if (ticket !== revision) return;
        busy = false;
        const message =
          error.name === "AbortError"
            ? "The study request timed out. Check the connection and retry."
            : error.message;
        detail.innerHTML = `<div class="water-study-error" role="alert"><h2>Investigation unavailable</h2><p>${esc(message)}</p><button type="button" class="btn" data-water-action="retry">Retry study</button><button type="button" class="journey-text-button" data-water-action="close">Return to satellite context</button></div>`;
        detail
          .querySelector('[data-water-action="retry"]')
          .addEventListener("click", () => open(entry));
      }
    }
    detail.addEventListener("click", (event) => {
      const sector = event.target.closest("[data-water-sector]");
      if (sector && study) select(Number(sector.dataset.waterSector));
      const action = event.target.closest("[data-water-action]")?.dataset
        .waterAction;
      if (action === "close") {
        close();
        onClose();
      }
      if (action === "export" && study) {
        const reviews = reviewState();
        const reviewText = reviews.error
          ? `\n\n## Human review\n\nReview records unavailable: ${reviews.error}\n`
          : SBWaterReviews.markdown(reviews.records);
        const blob = new Blob([markdown(study, selected) + reviewText], {
            type: "text/markdown;charset=utf-8",
          }),
          url = URL.createObjectURL(blob),
          a = document.createElement("a");
        a.href = url;
        a.download = `SAR-BRIDGE-${study.id}-${selected === null ? "whole" : `sector-${selected}`}.md`;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    });
    return {
      open,
      close,
      active: () => Boolean(study) || busy,
      fit: () => {
        if (study)
          getMap().fitBounds(study.bounds, {
            padding: [12, 12],
            animate: false,
          });
      },
    };
  }
  return { create, validate, markdown };
})();
