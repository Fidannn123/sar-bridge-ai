/* SAR-BRIDGE AI front end. All data are pre-computed by the Python pipeline (web/data/*). */
"use strict";

const STATUS_TEXT = {
  supported: "Supported hypothesis", plausible: "Plausible but unconfirmed",
  insufficient: "Insufficient evidence", not_supported: "Not supported by available data",
  no_change: "No significant change detected",
};
const MARK = { supports: "✓", contradicts: "✕", neutral: "–", missing: "?" };
const MARK_LABEL = { supports: "supports", contradicts: "contradicts", neutral: "neutral", missing: "missing" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SEL = "#5eead4";            // selection stroke on imagery (same in both themes: it sits on the map)

const D = {};
const S = { imagery: "HH", slider: 0.5, selected: null };
let map, panes = {}, overlays = {}, sectorLayer, tagLayer, polyLayer, osmLayer;

/* ------------------------------------------------------------------ utils */
const $ = (s) => document.querySelector(s);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (x, d = 0) => (x === null || x === undefined || Number.isNaN(+x)) ? "n/a"
  : Number(x).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
const ha = (x) => (x === null || x === undefined) ? "n/a" : `${num(x, Math.abs(x) < 100 ? 1 : 0)} ha`;
const pct = (f) => (f === null || f === undefined) ? "n/a" : `${num(100 * f, 1)}%`;
const km2 = (h) => (h === null || h === undefined) ? "" : `${num(h / 100, 1)} km²`;
const nice = (iso) => { if (!iso) return ""; const [y, m, d] = iso.slice(0, 10).split("-"); return `${+d} ${MONTHS[+m - 1]} ${y}`; };

async function getJSON(p) {
  try { const r = await fetch(p, { cache: "no-cache" }); return r.ok ? await r.json() : null; } catch { return null; }
}
async function loadAll() {
  const files = { layers: "data/layers.json", stats: "data/stats.json", analysis: "data/analysis.json", meta: "data/meta.json",
    sectors: "data/sectors.geojson", polys: "data/change_polygons.geojson", osm: "data/reservoir_osm.geojson" };
  (await Promise.all(Object.entries(files).map(async ([k, p]) => [k, await getJSON(p)]))).forEach(([k, v]) => (D[k] = v));
}

/* ------------------------------------------------------------------ map */
function initMap() {
  map = L.map("map", { zoomControl: false, minZoom: 7, maxZoom: 16, zoomSnap: 0.25 });
  L.control.zoom({ position: "topright" }).addTo(map);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    attribution: "Basemap © Esri, Maxar, Earthstar Geographics", maxZoom: 18,
  }).addTo(map);
  L.control.scale({ imperial: false, position: "bottomright", maxWidth: 120 }).addTo(map);
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution("NISAR © NASA/JPL–ISRO via ASF · Sentinel-2 © ESA Copernicus · © OSM contributors");
  [["before", 410], ["after", 411], ["change", 420], ["sectors", 430], ["polys", 440], ["osm", 445]].forEach(([n, z]) => {
    panes[n] = map.createPane(n); panes[n].style.zIndex = z;
  });

  const ly = D.layers || {};
  map.fitBounds(ly.change_map?.bounds || ly.s2_after?.bounds || [[40.76, 46.47], [41.08, 47.2]], { padding: [10, 10] });
  for (const [name, spec] of Object.entries(ly)) {
    const pane = name.includes("before") ? "before" : name.includes("after") ? "after" : "change";
    overlays[name] = L.imageOverlay(spec.url, spec.bounds, { pane, interactive: false });
  }
  if (D.osm) {
    osmLayer = L.geoJSON(D.osm, {
      pane: "osm", style: { color: "#fde68a", weight: 1.5, dashArray: "5 5", fill: false },
      pointToLayer: (f, ll) => L.circleMarker(ll, { pane: "osm", radius: 5, color: "#12201f", weight: 2, fillColor: "#fde68a", fillOpacity: 1 })
        .bindTooltip("Mingachevir dam (OpenStreetMap)", { className: "tt" }),
    });
  }
  if (D.sectors) buildSectors();
  if (D.polys) buildPolys();
  map.on("move zoom zoomend resize viewreset", updateClip);
}

const baseStyle = () => ({ color: "#ffffff", weight: 1, opacity: 0.75, dashArray: "3 4", fill: true, fillColor: "#ffffff", fillOpacity: 0 });
const selStyle = () => ({ color: SEL, weight: 3, opacity: 1, dashArray: null, fill: true, fillColor: SEL, fillOpacity: 0.12 });

function buildSectors() {
  sectorLayer = L.geoJSON(D.sectors, {
    pane: "sectors", style: baseStyle,
    onEachFeature: (f, layer) => {
      const p = f.properties;
      layer.bindTooltip(`<b>${esc(p.name)}</b><br>Water loss <span class="num">${ha(p.loss_ha)}</span> · gain <span class="num">${ha(p.gain_ha)}</span><br>Valid data <span class="num">${pct(p.valid_fraction)}</span>`,
        { className: "tt", sticky: true });
      layer.on({
        mouseover: () => { if (S.selected !== p.id) layer.setStyle({ fillOpacity: 0.08, dashArray: null, opacity: 1 }); },
        mouseout: () => { if (S.selected !== p.id) layer.setStyle(baseStyle()); },
        click: () => selectSector(p.id),
      });
    },
  });
  tagLayer = L.layerGroup(D.sectors.features.map((f) => {
    const p = f.properties;
    return L.marker([p.label_lat, p.label_lon], {
      icon: L.divIcon({ className: "sector-tag", html: `<b>S${p.id}</b>`, iconSize: [0, 0] }), title: p.name, pane: "osm",
    }).on("click", () => selectSector(p.id));
  }));
}

function buildPolys() {
  const renderer = L.canvas({ pane: "polys", padding: 0.3 });
  polyLayer = L.geoJSON(D.polys, {
    renderer,
    style: (f) => ({ color: f.properties.change === "gain" ? "#93c5fd" : "#fdba74", weight: 1.6, opacity: 0, fill: true, fillOpacity: 0 }),
    onEachFeature: (f, layer) => {
      const p = f.properties;
      layer.bindTooltip(`<b>${p.change === "gain" ? "Water gain" : "Water loss"}</b> · <span class="num">${ha(p.area_ha)}</span>${p.sector ? ` · Sector ${p.sector}` : ""}`, { className: "tt", sticky: true });
      layer.on({ mouseover: () => layer.setStyle({ opacity: 1 }), mouseout: () => layer.setStyle({ opacity: 0 }),
        click: () => p.sector && selectSector(p.sector) });
    },
  });
}

/* ------------------------------------------------------------------ imagery & comparison slider */
const imageryKeys = () => S.imagery === "S2" ? ["s2_before", "s2_after"] : [`nisar_before_${S.imagery}`, `nisar_after_${S.imagery}`];

function dateOf(key) {
  const spec = D.layers?.[key];
  if (spec?.date) return spec.date;
  if (key.startsWith("s2_")) return D.meta?.sentinel2?.scenes?.[key.slice(3)]?.datetime_utc?.slice(0, 10) || "";
  return "";
}
function toggle(layer, on) {
  if (!layer) return;
  if (on && !map.hasLayer(layer)) layer.addTo(map);
  if (!on && map.hasLayer(layer)) map.removeLayer(layer);
}

function applyLayers() {
  const [kb, ka] = imageryKeys();
  ["nisar_before_HH", "nisar_after_HH", "nisar_before_HV", "nisar_after_HV", "s2_before", "s2_after"].forEach((k) => toggle(overlays[k], false));
  const compare = $("#chk-slider").checked && !!overlays[kb];
  toggle(overlays[ka], true);
  toggle(overlays[kb], compare);
  const showChange = $("#chk-change").checked;
  toggle(overlays.change_map, showChange);
  toggle(polyLayer, showChange);
  toggle(sectorLayer, $("#chk-sectors").checked);
  toggle(tagLayer, $("#chk-sectors").checked);
  toggle(osmLayer, $("#chk-osm").checked);

  const sensor = S.imagery === "S2" ? "Sentinel-2" : `NISAR ${S.imagery}`;
  $("#flag-before").innerHTML = `<small>Before</small>${esc(nice(dateOf(kb)))}`;
  $("#flag-after").innerHTML = `<small>After</small>${esc(nice(dateOf(ka)))}`;
  $("#divider").hidden = !compare;
  $("#solo-flag").hidden = compare;
  $("#solo-flag").textContent = overlays[ka] ? `${sensor} · ${nice(dateOf(ka))}` : "NISAR imagery not processed yet";

  // legend: change classes + the backscatter scale of the imagery on screen
  $("#lg-change").hidden = !showChange;
  const spec = D.layers?.[ka];
  const radar = S.imagery !== "S2" && spec?.vmin_db !== undefined;
  $("#lg-scale").hidden = !radar;
  if (radar) {
    $("#lg-scale-title").innerHTML = `Radar backscatter <span class="nocase">γ<sup>0</sup></span> ${S.imagery}`;
    $("#lg-min").textContent = `${spec.vmin_db} dB`;
    $("#lg-max").textContent = `${spec.vmax_db} dB`;
  }
  updateClip();
}

function updateClip() {
  if (!map) return;
  const size = map.getSize();
  if ($("#divider").hidden) { panes.before.style.clip = panes.after.style.clip = ""; return; }
  const nw = map.containerPointToLayerPoint([0, 0]), se = map.containerPointToLayerPoint(size);
  const x = nw.x + size.x * S.slider;
  panes.before.style.clip = `rect(${nw.y}px, ${x}px, ${se.y}px, ${nw.x}px)`;
  panes.after.style.clip = `rect(${nw.y}px, ${se.x}px, ${se.y}px, ${x}px)`;
  $("#divider").style.left = `${size.x * S.slider}px`;
  $("#divider .handle").setAttribute("aria-valuenow", Math.round(S.slider * 100));
}

function initSlider() {
  const handle = $("#divider .handle"), box = $(".map-area");
  const set = (e) => { const r = box.getBoundingClientRect(); S.slider = Math.min(0.97, Math.max(0.03, (e.clientX - r.left) / r.width)); updateClip(); };
  handle.addEventListener("pointerdown", (e) => {
    handle.setPointerCapture(e.pointerId);
    const mv = (ev) => set(ev);
    const up = () => { handle.removeEventListener("pointermove", mv); handle.removeEventListener("pointerup", up); };
    handle.addEventListener("pointermove", mv); handle.addEventListener("pointerup", up);
    e.preventDefault();
  });
  handle.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") S.slider = Math.max(0.03, S.slider - 0.03);
    else if (e.key === "ArrowRight") S.slider = Math.min(0.97, S.slider + 0.03);
    else return;
    e.preventDefault(); updateClip();
  });
}

function initControls() {
  document.querySelectorAll("#imagery-seg button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("#imagery-seg button").forEach((x) => { x.classList.remove("on"); x.setAttribute("aria-checked", "false"); });
    b.classList.add("on"); b.setAttribute("aria-checked", "true");
    S.imagery = b.dataset.img; applyLayers();
  }));
  ["#chk-slider", "#chk-change", "#chk-sectors", "#chk-osm"].forEach((id) => $(id).addEventListener("change", applyLayers));
  $("#btn-method").addEventListener("click", openMethod);
  $("#btn-close").addEventListener("click", closeMethod);
  $("#method").addEventListener("click", (e) => { if (e.target.id === "method") closeMethod(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMethod(); });
  window.addEventListener("hashchange", fromHash);
  let t;
  window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(drawProfile, 120); });
  window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", drawProfile);
}

/* ------------------------------------------------------------------ header context + summary */
function renderContext() {
  const p = D.meta?.nisar?.pair, st = D.stats;
  if (!p) return;
  $("#context").innerHTML = `<b>Mingachevir Reservoir</b>, Azerbaijan · NISAR L-band, track ${p.before.track} ${p.before.direction === "ASCENDING" ? "ascending" : "descending"} · `
    + `<b>${nice(p.before.start_time)} → ${nice(p.after.start_time)}</b>${st ? ` (${st.days_between} days)` : ""}`;
}

function renderSummary() {
  const el = $("#stats"), st = D.stats;
  if (!st) {
    el.innerHTML = `<p class="note">No measurements yet. Run <span class="mono">python pipeline/run_all.py</span> to process the NISAR scenes.</p>`;
    return;
  }
  const t = st.totals;
  el.innerHTML = `
    <div class="stat loss"><div class="k">Water lost</div><div class="v">${num(t.loss_ha)}<small>ha</small></div><div class="s">${km2(t.loss_ha)} became land</div></div>
    <div class="stat gain"><div class="k">Water gained</div><div class="v">${num(t.gain_ha)}<small>ha</small></div><div class="s">${km2(t.gain_ha)} became water</div></div>
    <div class="stat"><div class="k">Sectors analysed</div><div class="v">${st.n_sectors}</div><div class="s">along a ${num(st.reservoir_axis_length_km)} km axis</div></div>
    <div class="stat"><div class="k">Valid data coverage</div><div class="v">${num(100 * t.valid_fraction, 1)}<small>%</small></div><div class="s">${ha(t.insufficient_data_ha)} insufficient</div></div>
    <p class="note">Radar water map agrees with the same-day Sentinel-2 image (${esc(nice(st.optical_scenes.after.datetime_utc))}) on <b>${pct(t.optical.after_mask_agreement)}</b> of pixels.</p>`;
}

/* ------------------------------------------------------------------ sector chart */
function drawProfile() {
  const host = $("#profile");
  const secs = D.analysis?.sectors;
  if (!secs || !D.sectors) { host.innerHTML = `<div class="empty">The chart appears after NISAR processing.</div>`; return; }
  const col = { gain: css("--gain"), loss: css("--loss"), fg: css("--fg"), muted: css("--muted"), faint: css("--faint"), line: css("--line-strong"), surface: css("--surface") };
  const W = Math.max(300, host.clientWidth), H = host.clientHeight || 150;
  const padL = 40, padR = 4, top = 8, bottom = 22;
  const anyGain = secs.some((s) => s.detected_change.gain_ha > 0), anyLoss = secs.some((s) => s.detected_change.loss_ha > 0);
  const usable = H - top - bottom;
  const mid = top + (anyGain && anyLoss ? usable / 2 : anyGain ? usable : 0);
  const amp = anyGain && anyLoss ? usable / 2 : usable;
  const n = secs.length, cw = (W - padL - padR) / n, bw = Math.min(26, cw * 0.62);
  const raw = Math.max(1, ...secs.map((s) => Math.max(s.detected_change.gain_ha, s.detected_change.loss_ha)));
  const step = raw > 200 ? 100 : raw > 80 ? 50 : raw > 20 ? 10 : 5;
  const maxv = Math.ceil(raw / step) * step;
  const y = (v, dir) => dir === "gain" ? mid - (v / maxv) * amp : mid + (v / maxv) * amp;

  let grid = "";
  for (let v = step; v <= maxv; v += step) {
    if (anyLoss) grid += `<line x1="${padL}" x2="${W - padR}" y1="${y(v, "loss")}" y2="${y(v, "loss")}" stroke="${col.line}" stroke-width=".6" stroke-dasharray="2 3" opacity=".7"/>
      <text x="${padL - 6}" y="${y(v, "loss") + 3.5}" font-size="10" text-anchor="end" fill="${col.faint}">−${num(v)}</text>`;
    if (anyGain) grid += `<line x1="${padL}" x2="${W - padR}" y1="${y(v, "gain")}" y2="${y(v, "gain")}" stroke="${col.line}" stroke-width=".6" stroke-dasharray="2 3" opacity=".7"/>
      <text x="${padL - 6}" y="${y(v, "gain") + 3.5}" font-size="10" text-anchor="end" fill="${col.faint}">+${num(v)}</text>`;
  }
  let bars = "";
  secs.forEach((s, i) => {
    const x = padL + i * cw, cx = x + cw / 2, dc = s.detected_change;
    const hg = (dc.gain_ha / maxv) * amp, hl = (dc.loss_ha / maxv) * amp;
    const insuf = s.conclusion.status === "insufficient" && !s.significant_change;
    bars += `<g class="col${S.selected === s.id ? " sel" : ""}" data-id="${s.id}" tabindex="0" role="button" aria-pressed="${S.selected === s.id}" aria-label="${esc(s.name)}: water loss ${ha(dc.loss_ha)}, gain ${ha(dc.gain_ha)}">
      <rect class="hit" x="${x + 1}" y="0" width="${cw - 2}" height="${H}" rx="4"/>
      ${insuf ? `<text x="${cx}" y="${mid + 14}" font-size="10" text-anchor="middle" fill="${col.faint}">n/a</text>` : ""}
      ${dc.gain_ha > 0 ? `<rect x="${cx - bw / 2}" y="${mid - hg}" width="${bw}" height="${Math.max(hg, 1.5)}" rx="2" fill="${col.gain}"/>` : ""}
      ${dc.loss_ha > 0 ? `<rect x="${cx - bw / 2}" y="${mid}" width="${bw}" height="${Math.max(hl, 1.5)}" rx="2" fill="${col.loss}"/>` : ""}
      ${dc.loss_ha >= 10 ? `<text x="${cx}" y="${hl > 22 ? mid + hl - 6 : mid + hl + 11}" font-size="10" text-anchor="middle" font-weight="500" fill="${hl > 22 ? col.surface : col.muted}">${num(dc.loss_ha)}</text>` : ""}
      <text x="${cx}" y="${H - 6}" font-size="11" text-anchor="middle" font-weight="${S.selected === s.id ? 700 : 500}" fill="${S.selected === s.id ? col.fg : col.muted}">S${s.id}</text>
    </g>`;
  });
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" font-family="IBM Plex Mono, ui-monospace, monospace">
    ${grid}
    <line x1="${padL}" x2="${W - padR}" y1="${mid}" y2="${mid}" stroke="${col.fg}" stroke-width="1"/>
    <text x="${padL - 6}" y="${mid + 3.5}" font-size="10" text-anchor="end" fill="${col.muted}">0 ha</text>
    ${bars}</svg>`;
  host.querySelectorAll(".col").forEach((el) => {
    const id = Number(el.dataset.id);
    el.addEventListener("click", () => selectSector(S.selected === id ? null : id));
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectSector(S.selected === id ? null : id); } });
  });
}

/* ------------------------------------------------------------------ analysis card */
function selectSector(id, { fly = true } = {}) {
  const changed = S.selected !== id;
  S.selected = id;
  if (sectorLayer) sectorLayer.eachLayer((l) => {
    const sel = l.feature.properties.id === id;
    l.setStyle(sel ? selStyle() : baseStyle());
    if (sel) {
      l.bringToFront();
      if (fly && changed) map.flyToBounds(l.getBounds(), { padding: [60, 60], duration: 0.7, maxZoom: 12 });
    }
  });
  if (id === null && fly && changed && D.layers?.change_map) map.flyToBounds(D.layers.change_map.bounds, { padding: [10, 10], duration: 0.7 });
  if (tagLayer) tagLayer.eachLayer((m) => { const el = m.getElement(); if (el) el.classList.toggle("selected", el.textContent === `S${id}`); });
  const unit = id === null ? D.analysis?.study_area : D.analysis?.sectors.find((s) => s.id === id);
  renderCard(unit, id);
  drawProfile();
  const h = id === null ? "" : `#sector-${id}`;
  if (location.hash !== h && location.hash !== "#method") history.replaceState(null, "", h || location.pathname + location.search);
  if (window.innerWidth <= 860 && id !== null && changed) $("#analysis-card").scrollIntoView({ behavior: "smooth", block: "start" });
}
function fromHash() {
  if (location.hash === "#method") { selectSector(null, { fly: false }); openMethod(); return; }
  const m = location.hash.match(/sector[-=](\d+)/);
  selectSector(m ? Number(m[1]) : null);
}

const evList = (items) => `<ul class="ev">${items.map((e) => `<li><span class="mk ${e.direction}" title="${MARK_LABEL[e.direction]}" aria-label="${MARK_LABEL[e.direction]}">${MARK[e.direction]}</span><span>${esc(e.statement)}<span class="src">${esc(e.source)}</span></span></li>`).join("")}</ul>`;
const kv = (k, v, cls = "") => `<dt>${k}</dt><dd class="${cls}">${v}</dd>`;

function contextBlock() {
  const w = D.meta?.weather?.points?.reservoir, up = D.meta?.weather?.points?.upstream;
  if (!w) return "";
  const a = w.acquisitions, b = w.between, ser = w.daily_series;
  let spark = "";
  if (ser) {
    const t0 = a.before.time_utc.slice(0, 10), t1 = a.after.time_utc.slice(0, 10);
    const idx = ser.dates.map((d, i) => [d, i]).filter(([d]) => d >= t0 && d <= t1).map(([, i]) => i);
    const vals = idx.map((i) => ser.precipitation_sum_mm[i] ?? 0), max = Math.max(5, ...vals), bw = 100 / vals.length;
    spark = `<div class="spark"><svg viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label="Daily modelled precipitation between the two radar dates">
      <line x1="0" y1="29.7" x2="100" y2="29.7" stroke="${css("--line-strong")}" stroke-width=".4"/>
      ${vals.map((v, i) => `<rect x="${(i * bw).toFixed(2)}" y="${(29.5 - (v / max) * 28).toFixed(2)}" width="${Math.max(bw - 0.25, 0.25).toFixed(2)}" height="${((v / max) * 28).toFixed(2)}" fill="${css("--gain")}"><title>${ser.dates[idx[i]]}: ${v} mm</title></rect>`).join("")}
      </svg><div class="spark-axis"><span>${nice(t0)}</span><span>daily rain, max ${num(max, 1)} mm</span><span>${nice(t1)}</span></div></div>`;
  }
  return `<details class="ctx"><summary>Weather and soil between the two dates (ERA5, modelled)</summary>
    <dl class="kv">
      ${kv("Rain at the reservoir", `${num(b.precip_total_mm, 1)} mm`)}
      ${kv("Rain upstream (Alazani valley)", `${num(up?.between?.precip_total_mm, 1)} mm`)}
      ${kv("Reference evapotranspiration", `${num(b.et0_total_mm, 1)} mm`)}
      ${kv("Mean air temperature", `${num(b.temperature_2m_mean_c, 1)} °C`)}
      ${kv("Wind at each radar pass", `${num(a.before.wind_speed_10m_ms_at_acquisition, 1)} / ${num(a.after.wind_speed_10m_ms_at_acquisition, 1)} m/s`)}
      ${kv("Topsoil moisture", `${num(a.before.soil_moisture_0_7cm_m3m3, 3)} → ${num(a.after.soil_moisture_0_7cm_m3m3, 3)} m³/m³`)}
    </dl>${spark}
    <p class="fine">ERA5 is a reanalysis model on a 9–25 km grid, not a weather station at the reservoir.</p></details>`;
}

function renderCard(unit, id) {
  const el = $("#analysis-card");
  if (!D.analysis || !unit) {
    el.innerHTML = `<div class="card-head"><div><h2>Analysis</h2><p class="card-sub">Appears once the pipeline has processed real NISAR observations.</p></div></div>`;
    return;
  }
  const dc = unit.detected_change, c = unit.conclusion, ai = unit.ai_explanation, hyps = unit.hypotheses || [];
  const isTotal = id === null;
  const paras = ai ? ai.text.split(/\n\s*\n/).map((p) => `<p>${esc(p.trim())}</p>`).join("") : "";
  let meta = "";
  if (ai) {
    if (ai.source === "openai") {
      meta = `<span>Written by ${esc(ai.model)} from the evidence below</span>${ai.numbers_verified
        ? `<span class="ok">✓ ${ai.numbers_checked ?? "All"} number${ai.numbers_checked === 1 ? "" : "s"} checked against the measurements</span>`
        : `<span class="warn">Unverified numbers: ${esc(ai.unverified_numbers.join(", "))}</span>`}`;
    } else if (ai.rejected_llm_draft) {
      meta = `<span class="warn">The ${esc(ai.rejected_llm_draft.model)} draft failed the automatic checks, so this text comes straight from the evidence engine.</span>`;
    } else {
      meta = `<span class="warn">No language model configured: text generated directly from the evidence engine.</span>`;
    }
  }
  const sup = unit.supporting_evidence || [];
  const about = c.top_hypothesis || (c.status === "no_change" ? "Nothing to explain in this area" : "");
  el.innerHTML = `
    <div class="card-head">
      <div><h2>${esc(isTotal ? "Whole reservoir" : unit.name)}</h2>
      <p class="card-sub">${esc(unit.position ? unit.position.charAt(0).toUpperCase() + unit.position.slice(1) : "All 10 sectors combined. Select a sector on the map or in the chart.")}</p></div>
      ${isTotal ? "" : `<button class="link-btn" id="btn-back" type="button">All sectors</button>`}
    </div>

    <div class="verdict">
      <div class="verdict-top"><span class="chip ${c.status}">${esc(c.label)}</span><span class="about">${esc(about)}</span></div>
      ${c.reason ? `<p class="why">${esc(c.reason)}</p>` : ""}
    </div>

    <section class="sec"><h3>Detected change</h3>
      <p class="what">${esc(dc.what)}</p>
      <dl class="kv">
        ${kv("Water lost", ha(dc.loss_ha), "loss")}
        ${kv("Water gained", ha(dc.gain_ha), "gain")}
        ${kv("Net change", `${dc.net_change_ha > 0 ? "+" : ""}${ha(dc.net_change_ha)}`)}
        ${kv(`Radar-dark area, ${nice(dc.dates[0])}`, ha(dc.water_before_ha))}
        ${kv(`Radar-dark area, ${nice(dc.dates[1])}`, ha(dc.water_after_ha))}
        ${kv("Valid data on both dates", pct(dc.valid_fraction))}
      </dl>
      <p class="fine">Radar-dark area includes smooth ground that looks as dark as water to the radar, so it overstates the true water area. Change is only counted where the radar signal itself changed by at least 3 dB.</p>
    </section>

    <section class="sec"><h3>AI interpretation</h3>
      ${ai ? `<div class="ai-box">${paras}<div class="ai-meta">${meta}</div></div>` : ""}
    </section>

    ${hyps.length ? `<section class="sec"><h3>Possible explanations, ranked by evidence</h3>
      ${hyps.map((h, i) => `<details class="hyp"${i === 0 && unit.significant_change ? " open" : ""}>
        <summary><span class="r">${i + 1}</span><span class="t">${esc(h.title)}</span><span class="chip ${h.status}">${esc(STATUS_TEXT[h.status])}</span></summary>
        <div class="body">${h.reason ? `<p class="h-why">${esc(h.reason)}</p>` : ""}${h.note ? `<p class="h-note">${esc(h.note)}</p>` : ""}${evList(h.evidence)}</div></details>`).join("")}
    </section>` : ""}

    <section class="sec"><h3>Supporting evidence</h3>
      ${sup.length ? evList(sup) : `<p class="fine" style="margin:0">No explanation reached "plausible" or better here, so nothing counts as support.</p>`}
      ${contextBlock()}
    </section>

    <section class="sec"><h3>Missing evidence</h3>
      <ul class="miss">${(unit.missing_evidence || []).map((m) => `<li>${esc(m)}</li>`).join("")}</ul>
    </section>

    <section class="sec"><h3>Conclusion</h3>
      <p class="what" style="margin-bottom:6px">${esc(c.summary)}</p>
      <p class="fine">Explanations are tested against the available data; none is presented as a confirmed cause. SAR-BRIDGE AI is a research prototype, not a dam-safety or forecasting system.</p>
    </section>`;
  $("#btn-back")?.addEventListener("click", () => selectSector(null));
}

/* ------------------------------------------------------------------ method sheet */
function openMethod() { renderMethod(); $("#method").hidden = false; $("#btn-close").focus(); }
function closeMethod() {
  if ($("#method").hidden) return;
  $("#method").hidden = true;
  if (location.hash === "#method") history.replaceState(null, "", location.pathname + location.search);
}

function renderMethod() {
  const m = D.meta, st = D.stats, an = D.analysis, body = $("#method-body");
  if (!m) { body.innerHTML = "<p>Metadata has not been generated yet.</p>"; return; }
  const p = m.nisar.pair, rl = m.nisar.read_log || {};
  const tr = (k, f) => `<tr><th>${k}</th><td class="mono">${f(p.before, "before")}</td><td class="mono">${f(p.after, "after")}</td></tr>`;
  const inv = [...(m.nisar.inventory || [])].sort((a, b) => a.start_time.localeCompare(b.start_time));
  const t0 = Date.parse(inv[0]?.start_time), t1 = Date.parse(inv[inv.length - 1]?.start_time);
  const pos = (t) => (100 * (Date.parse(t) - t0) / Math.max(1, t1 - t0)).toFixed(2);
  const sel = [p.before.start_time, p.after.start_time];
  body.innerHTML = `
    <p>SAR-BRIDGE AI compares two NASA–ISRO NISAR radar observations of Mingachevir Reservoir, maps where water appeared or disappeared, and uses a rule-based evidence engine plus a language model to report which environmental explanations the available data support. It performs pairwise change detection only.</p>

    <h3>NISAR observations</h3>
    <div class="tbl"><table class="t"><tr><th></th><th>Before</th><th>After</th></tr>
      ${tr("Acquired (UTC)", (g) => esc(g.start_time))}
      ${tr("Granule", (g) => esc(g.granule_id))}
      ${tr("Collection", (g) => `${esc(g.collection)} (${esc(g.data_maturity)})`)}
      ${tr("Track, direction, frame", (g) => `${g.track}, ${esc(g.direction.toLowerCase())}, ${g.frame}`)}
      ${tr("Polarisations", (g) => `${esc((g.frequency_a_polarizations || []).join(" + "))}, ${esc(g.frequency_a_bandwidth_mhz)} MHz`)}
      ${tr("Product version, CRID", (g) => `${esc(g.product_version)}, ${esc(g.crid)}`)}
      ${tr("Orbit", (g) => esc(g.orbit_type))}
      ${tr("Native grid", (g, k) => rl[k]?.native_spacing_m ? `${esc(rl[k].native_spacing_m.map(Math.abs).join(" × "))} m, EPSG:${esc(rl[k].native_epsg)}` : "n/a")}
      ${tr("Granule size", (g) => g.size_mb ? `${num(g.size_mb / 1024, 1)} GB (only the reservoir window was streamed)` : "n/a")}
      ${tr("Links", (g) => `<a href="${esc(g.cmr_url)}" target="_blank" rel="noopener">CMR record</a> · <a href="${esc(g.qa_report_url)}" target="_blank" rel="noopener">QA report</a>`)}
    </table></div>
    <p class="small">Why this pair:</p><ul>${m.nisar.selection_rationale.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
    <p class="small">All ${m.nisar.inventory_count} NISAR GCOV acquisitions over the area. Grey: provisional, green: validated, teal: the pair used.</p>
    <div class="timeline">${inv.map((r) => `<div class="tk ${r.maturity === "validated" ? "validated" : ""} ${sel.includes(r.start_time) ? "sel" : ""}" style="left:${pos(r.start_time)}%" title="${esc(r.start_time)}, track ${r.track}${esc(r.direction)}, ${esc(r.maturity)}"></div>`).join("")}
      ${sel.map((t) => `<div class="lbl" style="left:${pos(t)}%">${esc(nice(t))}</div>`).join("")}</div>
    <div class="tl-axis"><span>${esc(nice(inv[0]?.start_time))}</span><span>${esc(nice(inv[inv.length - 1]?.start_time))}</span></div>

    <h3>Processing</h3>
    <ol>${m.method_steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
    ${st ? `<div class="tbl"><table class="t"><tr><th>Water threshold</th><th>HH</th><th>HV</th></tr>
      ${["before", "after"].map((k) => {
        const cell = (pp) => { const t = st.thresholds[`${k}_${pp}`]; return `${t.threshold_db} dB${t.clamped ? ` (Otsu ${t.otsu_raw_db} dB, clamped${t.separable === false ? "; not separable" : ""})` : ""}`; };
        return `<tr><td>${esc(nice(st.pair[k].date))}</td><td class="mono">${cell("HH")}</td><td class="mono">${cell("HV")}</td></tr>`;
      }).join("")}</table></div>
      ${st.separability ? `<p class="small">If the data-driven Otsu split falls more than ${st.separability.max_clamp_db} dB outside the plausible range, that polarisation is treated as having no usable water/land contrast. Here HH is ${st.separability.HH ? "usable" : "not separable"} and HV is ${st.separability.HV ? "usable" : "not separable"}, so HV checks are reported as missing evidence rather than as contradictions.</p>` : ""}` : ""}

    ${an ? `<h3>Evidence-engine rules</h3>
      <p class="small">Fixed, physically motivated thresholds. Each explanation collects evidence labelled supports, contradicts, neutral or missing, and its status follows explicit rules in <span class="mono">pipeline/06_evidence.py</span>.</p>
      <div class="tbl"><table class="t">${Object.entries(an.rules).map(([k, v]) => `<tr><th>${esc(k.replaceAll("_", " "))}</th><td class="mono">${esc(v)}</td></tr>`).join("")}</table></div>` : ""}

    <h3>Optical cross-check (Sentinel-2)</h3>
    <div class="tbl"><table class="t"><tr><th>Scene</th><th>Acquired (UTC)</th><th>Offset from NISAR</th><th>Cloud</th></tr>
      ${Object.values(m.sentinel2.scenes).map((s) => `<tr><td class="mono"><a href="${esc(s.stac_url)}" target="_blank" rel="noopener">${esc(s.item_id)}</a></td><td class="mono">${esc(s.datetime_utc)}</td><td class="mono">${s.days_from_nisar > 0 ? "+" : ""}${num(s.days_from_nisar, 1)} d (${esc(s.paired_nisar)})</td><td class="mono">${num(s.scene_cloud_cover_pct, 1)}%</td></tr>`).join("")}
    </table></div>
    <p class="small">${esc(m.sentinel2.method)}</p>
    ${(m.sentinel2.processing_notes || []).length ? `<p class="small">The reflectance offset listed in the scene metadata produced negative reflectance for these scenes, so it was not applied. Each case is logged in <span class="mono">data/context/sentinel2.json</span>.</p>` : ""}

    <h3>Data sources</h3>
    <div class="tbl"><table class="t"><tr><th>Dataset</th><th>Provider</th><th>Licence</th></tr>
      ${m.sources.map((s) => `<tr><td><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a></td><td>${esc(s.provider)}</td><td>${esc(s.license)}</td></tr>`).join("")}</table></div>

    <h3>Limitations</h3>
    <ul>${m.limitations.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
    <p class="small">Generated ${esc(m.generated_utc)}.</p>`;
}

/* ------------------------------------------------------------------ boot */
(async function boot() {
  await loadAll();
  initMap();
  initSlider();
  initControls();
  applyLayers();
  renderContext();
  renderSummary();
  fromHash();
})();
