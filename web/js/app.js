/* SAR-BRIDGE AI · static front end. All data are pre-computed by the Python pipeline (web/data/*). */
"use strict";

const C = { gain: "#1f5fd6", loss: "#d9481c", hl: "#ffd60a", ink: "#16181b", paper: "#f2ede3" };
const STATUS_TEXT = {
  supported: "Supported hypothesis", plausible: "Plausible but unconfirmed",
  insufficient: "Insufficient evidence", not_supported: "Not supported by available data",
  no_change: "No significant change detected",
};
const MARK = { supports: "✓", contradicts: "✕", neutral: "·", missing: "?" };
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

const D = {};
const S = { imagery: "HH", slider: 0.5, selected: null };
let map, panes = {}, overlays = {}, sectorLayer, tagLayer, polyLayer, osmLayer;

/* ------------------------------------------------------------------ utils */
const $ = (s) => document.querySelector(s);
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
  L.control.scale({ imperial: false, position: "bottomright", maxWidth: 140 }).addTo(map);
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution("NISAR © NASA/JPL–ISRO via ASF · Sentinel-2 © ESA Copernicus · © OSM contributors");
  [["before", 410], ["after", 411], ["change", 420], ["sectors", 430], ["polys", 440], ["osm", 445]].forEach(([n, z]) => {
    panes[n] = map.createPane(n); panes[n].style.zIndex = z;
  });

  const ly = D.layers || {};
  map.fitBounds(ly.change_map?.bounds || ly.s2_after?.bounds || [[40.76, 46.47], [41.08, 47.2]], { padding: [4, 4] });
  for (const [name, spec] of Object.entries(ly)) {
    const pane = name.includes("before") ? "before" : name.includes("after") ? "after" : "change";
    overlays[name] = L.imageOverlay(spec.url, spec.bounds, { pane, interactive: false });
  }
  if (D.osm) {
    osmLayer = L.geoJSON(D.osm, {
      pane: "osm", style: { color: C.hl, weight: 1.6, dashArray: "6 5", fill: false },
      pointToLayer: (f, ll) => L.circleMarker(ll, { pane: "osm", radius: 5, color: C.ink, weight: 2, fillColor: C.hl, fillOpacity: 1 })
        .bindTooltip("Mingəçevir dam (OpenStreetMap)", { className: "tt" }),
    });
  }
  if (D.sectors) buildSectors();
  if (D.polys) buildPolys();
  map.on("move zoom zoomend resize viewreset", () => { updateClip(); drawGraticule(); });
  map.on("mousemove", (e) => { $("#readout").textContent = `${e.latlng.lat.toFixed(4)}° N  ${e.latlng.lng.toFixed(4)}° E`; });
  map.on("mouseout", () => { $("#readout").textContent = "—"; });
}

const baseStyle = () => ({ color: C.paper, weight: 1.1, opacity: 0.85, dashArray: "4 4", fill: true, fillColor: C.paper, fillOpacity: 0 });
const selStyle = () => ({ color: C.hl, weight: 3.5, opacity: 1, dashArray: null, fill: true, fillColor: C.hl, fillOpacity: 0.1 });

function buildSectors() {
  sectorLayer = L.geoJSON(D.sectors, {
    pane: "sectors", style: baseStyle,
    onEachFeature: (f, layer) => {
      const p = f.properties;
      layer.bindTooltip(`<b>S${p.id}</b> ${esc(p.name.replace(/^Sector \d+\s*/, ""))}<br>loss <b style="color:${C.loss}">${ha(p.loss_ha)}</b> · gain <b style="color:${C.gain}">${ha(p.gain_ha)}</b><br>valid data ${pct(p.valid_fraction)}`,
        { className: "tt", sticky: true });
      layer.on({
        mouseover: () => { if (S.selected !== p.id) layer.setStyle({ fillOpacity: 0.08, dashArray: null }); },
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
    style: (f) => ({ color: f.properties.change === "gain" ? "#8fb4ff" : "#ffb08f", weight: 1.6, opacity: 0, fill: true, fillOpacity: 0 }),
    onEachFeature: (f, layer) => {
      const p = f.properties;
      layer.bindTooltip(`<b>${p.change === "gain" ? "Water gain" : "Water loss"}</b> · ${ha(p.area_ha)}${p.sector ? ` · S${p.sector}` : ""}`, { className: "tt", sticky: true });
      layer.on({ mouseover: () => layer.setStyle({ opacity: 1 }), mouseout: () => layer.setStyle({ opacity: 0 }),
        click: () => p.sector && selectSector(p.sector) });
    },
  });
}

/* graticule labels in the plate margin */
function drawGraticule() {
  const top = $("#grat-top"), left = $("#grat-left");
  if (!map || !top) return;
  const b = map.getBounds(), z = map.getZoom();
  const step = z >= 12 ? 0.02 : z >= 11 ? 0.05 : z >= 9.5 ? 0.1 : 0.25;
  const fmt = (v) => v.toFixed(step < 0.05 ? 2 : step < 0.25 ? 2 : 2).replace(/0$/, "");
  const size = map.getSize();
  let h = "";
  for (let lon = Math.ceil(b.getWest() / step) * step; lon <= b.getEast(); lon += step) {
    const x = map.latLngToContainerPoint([b.getCenter().lat, lon]).x;
    if (x > 24 && x < size.x - 24) h += `<span style="left:${x}px">${fmt(lon)}°E</span>`;
  }
  top.innerHTML = h;
  h = "";
  for (let lat = Math.ceil(b.getSouth() / step) * step; lat <= b.getNorth(); lat += step) {
    const y = map.latLngToContainerPoint([lat, b.getCenter().lng]).y;
    if (y > 24 && y < size.y - 24) h += `<span style="top:${y}px">${fmt(lat)}°N</span>`;
  }
  left.innerHTML = h;
}

/* ------------------------------------------------------------------ imagery & slider */
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
  const sliderOn = $("#chk-slider").checked && !!overlays[kb];
  toggle(overlays[ka], true);
  toggle(overlays[kb], sliderOn);
  toggle(overlays.change_map, $("#chk-change").checked);
  toggle(polyLayer, $("#chk-change").checked);
  toggle(sectorLayer, $("#chk-sectors").checked);
  toggle(tagLayer, $("#chk-sectors").checked);
  toggle(osmLayer, $("#chk-osm").checked);

  const sensor = S.imagery === "S2" ? "SENTINEL-2" : `NISAR ${S.imagery}`;
  $("#flag-before").innerHTML = `<small>BEFORE · ${sensor}</small>${esc(nice(dateOf(kb)))}`;
  $("#flag-after").innerHTML = `<small>AFTER · ${sensor}</small>${esc(nice(dateOf(ka)))}`;
  $("#divider").hidden = !sliderOn;
  const solo = $("#solo-flag");
  solo.hidden = sliderOn;
  solo.textContent = overlays[ka] ? `${sensor} · ${nice(dateOf(ka))}` : "NISAR imagery not processed yet";
  $("#legend").style.display = $("#chk-change").checked ? "" : "none";
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
  const handle = $("#divider .handle"), box = $(".map-box");
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
  window.addEventListener("resize", () => drawProfile());
}

/* ------------------------------------------------------------------ masthead ticker + ledger */
function renderTicker() {
  const st = D.stats, m = D.meta;
  const p = m?.nisar?.pair;
  if (!p) return;
  const parts = [
    "NASA–ISRO NISAR", "L-band SAR", `Track ${p.before.track} ${p.before.direction === "ASCENDING" ? "asc" : "desc"} · frame ${p.before.frame}`,
    `<b>${nice(p.before.start_time)} → ${nice(p.after.start_time)}</b>`,
  ];
  if (st) parts.push(`${st.days_between} days`, "HH + HV", "20 m grid", `${st.n_sectors} sectors`);
  $("#ticker").innerHTML = parts.join("  ·  ");
}

function renderLedger() {
  const el = $("#stats"), st = D.stats;
  if (!st) {
    el.innerHTML = `<div class="it foot">No measurements yet: run <span class="mono">python pipeline/run_all.py</span>. Nothing is shown until real NISAR data have been processed.</div>`;
    return;
  }
  const t = st.totals;
  el.innerHTML = `
    <div class="it loss"><div class="lbl">Water lost</div><div class="big">${num(t.loss_ha)}<small>ha</small></div><div class="sub">${km2(t.loss_ha)} turned to land</div></div>
    <div class="it gain"><div class="lbl">Water gained</div><div class="big">${num(t.gain_ha)}<small>ha</small></div><div class="sub">${km2(t.gain_ha)} turned to water</div></div>
    <div class="it"><div class="lbl">Sectors analysed</div><div class="big">${st.n_sectors}</div><div class="sub">along a ${num(st.reservoir_axis_length_km)} km axis</div></div>
    <div class="it"><div class="lbl">Valid data</div><div class="big">${num(100 * t.valid_fraction, 1)}<small>%</small></div><div class="sub">${ha(t.insufficient_data_ha)} insufficient</div></div>
    <div class="it foot">Radar water mask vs. same-day Sentinel-2 (${esc(nice(st.optical_scenes.after.datetime_utc))}): <b>${pct(t.optical.after_mask_agreement)}</b> pixel agreement.</div>`;
}

/* ------------------------------------------------------------------ plate 2 · axis profile */
function drawProfile() {
  const host = $("#profile");
  const secs = D.analysis?.sectors;
  const sm = D.sectors?.features;
  if (!secs || !sm) { host.innerHTML = `<div class="empty">Profile appears after NISAR processing.</div>`; return; }
  const W = Math.max(320, host.clientWidth), H = host.clientHeight || 132;
  const padL = 46, padR = 12, top = 18, bottom = 20;          // reserve rows for end labels and x labels
  const anyGain = secs.some((s) => s.detected_change.gain_ha > 0), anyLoss = secs.some((s) => s.detected_change.loss_ha > 0);
  const usable = H - top - bottom;
  const mid = top + (anyGain && anyLoss ? usable / 2 : anyGain ? usable - 6 : 6);
  const amp = anyGain && anyLoss ? usable / 2 - 4 : usable - 12;
  const n = secs.length, cw = (W - padL - padR) / n;
  const maxv = Math.max(1, ...secs.map((s) => Math.max(s.detected_change.gain_ha, s.detected_change.loss_ha)));
  let g = "";
  secs.forEach((s, i) => {
    const x = padL + i * cw, dc = s.detected_change;
    const hg = (dc.gain_ha / maxv) * amp, hl = (dc.loss_ha / maxv) * amp;
    const insuf = !s.significant_change && s.conclusion.status === "insufficient";
    g += `<g class="col${S.selected === s.id ? " sel" : ""}" data-id="${s.id}" tabindex="0" role="button" aria-label="${esc(s.name)}: loss ${ha(dc.loss_ha)}, gain ${ha(dc.gain_ha)}">
      <rect class="bg" x="${x}" y="0" width="${cw}" height="${H}" fill="transparent"/>
      ${insuf ? `<rect x="${x + cw * 0.2}" y="${mid - amp}" width="${cw * 0.6}" height="${2 * amp}" fill="url(#hatch)" opacity=".7"/>` : ""}
      <rect x="${x + cw * 0.2}" y="${mid - hg}" width="${cw * 0.6}" height="${Math.max(hg, dc.gain_ha > 0 ? 1 : 0)}" fill="${C.gain}"/>
      <rect x="${x + cw * 0.2}" y="${mid}" width="${cw * 0.6}" height="${Math.max(hl, dc.loss_ha > 0 ? 1 : 0)}" fill="${C.loss}"/>
      <text x="${x + cw / 2}" y="${H - 6}" text-anchor="middle" font-size="10.5" font-weight="600" fill="${C.ink}">S${s.id}</text>
      ${dc.loss_ha > 0 ? (hl > 18
        ? `<text x="${x + cw / 2}" y="${mid + hl - 5}" text-anchor="middle" font-size="9.5" font-weight="600" fill="${C.paper}">${num(dc.loss_ha)}</text>`
        : `<text x="${x + cw / 2}" y="${mid + hl + 10}" text-anchor="middle" font-size="9" fill="${C.loss}">${num(dc.loss_ha, dc.loss_ha < 10 ? 1 : 0)}</text>`) : ""}
      ${dc.gain_ha > 0 ? (hg > 18
        ? `<text x="${x + cw / 2}" y="${mid - hg + 11}" text-anchor="middle" font-size="9.5" font-weight="600" fill="${C.paper}">${num(dc.gain_ha)}</text>`
        : `<text x="${x + cw / 2}" y="${mid - hg - 3}" text-anchor="middle" font-size="9" fill="${C.gain}">${num(dc.gain_ha, dc.gain_ha < 10 ? 1 : 0)}</text>`) : ""}
    </g>`;
  });
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="false">
    <defs><pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" stroke="#8a8f96" stroke-width="1.4"/></pattern></defs>
    <line x1="${padL}" y1="${mid}" x2="${W - padR}" y2="${mid}" stroke="${C.ink}" stroke-width="1.5"/>
    ${anyGain ? `<text x="6" y="${mid - amp + 8}" font-size="9.5" fill="${C.gain}">+${num(maxv)}</text>` : ""}
    ${anyLoss ? `<text x="6" y="${mid + amp}" font-size="9.5" fill="${C.loss}">−${num(maxv)}</text>` : ""}
    <text x="6" y="${mid + 4}" font-size="9.5" fill="${C.ink}">0 ha</text>
    <text x="${padL}" y="12" font-size="9.5" fill="#50555d">◀ NW · inflow end</text>
    <text x="${W - padR}" y="12" font-size="9.5" fill="#50555d" text-anchor="end">SE · dam ▶</text>
    ${!anyGain && W >= 640 ? `<text x="${W / 2}" y="12" font-size="9.5" fill="${C.gain}" text-anchor="middle">no water gain detected in any sector</text>` : ""}
    ${g}</svg>`;
  host.querySelectorAll(".col").forEach((el) => {
    const id = Number(el.dataset.id);
    el.addEventListener("click", () => selectSector(S.selected === id ? null : id));
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectSector(id); } });
  });
}

/* ------------------------------------------------------------------ report card */
function selectSector(id, { fly = true } = {}) {
  const changed = S.selected !== id;
  S.selected = id;
  if (sectorLayer) sectorLayer.eachLayer((l) => {
    const sel = l.feature.properties.id === id;
    l.setStyle(sel ? selStyle() : baseStyle());
    if (sel) {
      l.bringToFront();
      if (fly && changed) map.flyToBounds(l.getBounds(), { padding: [50, 50], duration: 0.7, maxZoom: 12 });
    }
  });
  if (id === null && fly && changed && D.layers?.change_map) map.flyToBounds(D.layers.change_map.bounds, { padding: [4, 4], duration: 0.7 });
  if (tagLayer) tagLayer.eachLayer((m) => { const el = m.getElement(); if (el) el.classList.toggle("selected", el.textContent === `S${id}`); });
  const unit = id === null ? D.analysis?.study_area : D.analysis?.sectors.find((s) => s.id === id);
  renderCard(unit, id);
  drawProfile();
  const h = id === null ? "" : `#sector=${id}`;
  if (location.hash !== h && location.hash !== "#methods") history.replaceState(null, "", h || location.pathname + location.search);
  if (window.innerWidth <= 900 && id !== null) $("#analysis-card").scrollIntoView({ behavior: "smooth", block: "start" });
}
function fromHash() {
  if (location.hash === "#methods") { selectSector(null, { fly: false }); openMethod(); return; }
  const m = location.hash.match(/sector=(\d+)/);
  selectSector(m ? Number(m[1]) : null);
}

const evList = (items) => `<ul class="ev">${items.map((e) => `<li><span class="mk ${e.direction}" title="${e.direction}" aria-label="${e.direction}">${MARK[e.direction]}</span><span>${esc(e.statement)}<span class="src">${esc(e.source)}</span></span></li>`).join("")}</ul>`;
const row = (k, v, cls = "") => `<div><dt>${k}</dt><span class="dots"></span><dd class="${cls}">${v}</dd></div>`;

function weatherBlock() {
  const w = D.meta?.weather?.points?.reservoir, up = D.meta?.weather?.points?.upstream;
  if (!w) return "";
  const a = w.acquisitions, b = w.between, ser = w.daily_series;
  let spark = "";
  if (ser) {
    const t0 = a.before.time_utc.slice(0, 10), t1 = a.after.time_utc.slice(0, 10);
    const idx = ser.dates.map((d, i) => [d, i]).filter(([d]) => d >= t0 && d <= t1).map(([, i]) => i);
    const vals = idx.map((i) => ser.precipitation_sum_mm[i] ?? 0), max = Math.max(5, ...vals), bw = 100 / vals.length;
    spark = `<div class="spark"><svg viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label="Daily modelled precipitation">
      ${vals.map((v, i) => `<rect x="${(i * bw).toFixed(2)}" y="${(30 - (v / max) * 28).toFixed(2)}" width="${Math.max(bw - 0.2, 0.25).toFixed(2)}" height="${((v / max) * 28).toFixed(2)}" fill="${C.gain}"><title>${ser.dates[idx[i]]}: ${v} mm</title></rect>`).join("")}
      </svg><div class="axis"><span>${nice(t0)}</span><span>daily rain, max ${num(max, 1)} mm</span><span>${nice(t1)}</span></div></div>`;
  }
  return `<details class="wx"><summary>+ Environmental context (ERA5, modelled)</summary><dl class="rows">
    ${row("Rain between dates (reservoir)", `${num(b.precip_total_mm, 1)} mm`)}
    ${row("Rain between dates (upstream)", `${num(up?.between?.precip_total_mm, 1)} mm`)}
    ${row("Reference evapotranspiration", `${num(b.et0_total_mm, 1)} mm`)}
    ${row("Mean air temperature", `${num(b.temperature_2m_mean_c, 1)} °C`)}
    ${row("Wind at acquisition (before / after)", `${num(a.before.wind_speed_10m_ms_at_acquisition, 1)} / ${num(a.after.wind_speed_10m_ms_at_acquisition, 1)} m/s`)}
    ${row("Topsoil moisture (before → after)", `${num(a.before.soil_moisture_0_7cm_m3m3, 3)} → ${num(a.after.soil_moisture_0_7cm_m3m3, 3)}`)}
    </dl>${spark}<p class="hnote">Reanalysis: a model reconstruction on a ~9–25 km grid, not a station at the reservoir.</p></details>`;
}

function renderCard(unit, id) {
  const el = $("#analysis-card");
  if (!D.analysis || !unit) {
    el.innerHTML = `<div class="eyebrow">Report</div><div class="card-title"><h2>Awaiting data</h2></div>
      <p class="pos">The evidence-based analysis appears once the pipeline has processed real NISAR observations. Nothing is shown before that.</p>`;
    return;
  }
  const dc = unit.detected_change, c = unit.conclusion, ai = unit.ai_explanation, hyps = unit.hypotheses || [];
  const isTotal = id === null;
  const paras = ai ? ai.text.split(/\n\s*\n/).map((p) => `<p>${esc(p.trim())}</p>`).join("") : "";
  let meta = "";
  if (ai) {
    meta = ai.source === "openai"
      ? `<span>Written by ${esc(ai.model)} from the evidence below</span>${ai.numbers_verified
          ? `<span class="ok">✓ ${ai.numbers_checked ?? "all"} number${ai.numbers_checked === 1 ? "" : "s"} traced to measurements</span>`
          : `<span class="warn">⚠ unverified: ${esc(ai.unverified_numbers.join(", "))}</span>`}`
      : ai.rejected_llm_draft
        ? `<span class="warn">LLM draft (${esc(ai.rejected_llm_draft.model)}) rejected by automatic checks: showing the evidence-engine template instead</span>`
        : `<span class="warn">Template text (no LLM configured), generated from the evidence engine</span>`;
  }
  const sup = unit.supporting_evidence || [];
  el.innerHTML = `
    <div class="eyebrow">${isTotal ? "Report · whole study area" : `Report · sector ${id} of ${D.analysis.sectors.length}`}</div>
    <div class="card-title"><h2>${esc(isTotal ? "Mingəçevir Reservoir" : unit.name)}</h2>${isTotal ? "" : `<button class="back" id="btn-back">← whole reservoir</button>`}</div>
    <p class="pos">${esc(unit.position || "All sectors combined. Drag the slider on Plate 1, then pick a sector on the map or in Plate 2.")}</p>

    <section class="sec"><div class="no">01</div><div><h3>Detected change</h3>
      <p class="what">${esc(dc.what)}</p>
      <dl class="rows">
        ${row("Water lost", ha(dc.loss_ha), "loss")}
        ${row("Water gained", ha(dc.gain_ha), "gain")}
        ${row("Net change", `${dc.net_change_ha > 0 ? "+" : ""}${ha(dc.net_change_ha)}`)}
        ${row(`Radar-dark area ${nice(dc.dates[0])}`, ha(dc.water_before_ha))}
        ${row(`Radar-dark area ${nice(dc.dates[1])}`, ha(dc.water_after_ha))}
        ${row("Valid data on both dates", pct(dc.valid_fraction))}
      </dl>
      <p class="hnote">Radar-dark area = water plus smooth ground that looks equally dark to the radar; it is not the true water area. Change is counted only where the radar signal itself changed by ≥ 3 dB.</p></div></section>

    <section class="sec"><div class="no">02</div><div><h3>AI interpretation</h3>
      ${ai ? `<div class="ai">${paras}<div class="ai-meta">${meta}</div></div>` : ""}
      ${hyps.length ? `<p class="hyp-intro">Candidate explanations, ranked by the evidence available. Open one to see why.</p>
        ${hyps.map((h, i) => `<details class="hyp"${i === 0 && unit.significant_change ? " open" : ""}>
          <summary><span class="r">${i + 1}</span><span class="t">${esc(h.title)}</span><span class="stamp ${h.status}">${esc(STATUS_TEXT[h.status])}</span></summary>
          <div class="body">${h.reason ? `<p class="why">${esc(h.reason)}</p>` : ""}${h.note ? `<p class="hnote">${esc(h.note)}</p>` : ""}${evList(h.evidence)}</div></details>`).join("")}` : ""}
    </div></section>

    <section class="sec"><div class="no">03</div><div><h3>Supporting evidence</h3>
      ${sup.length ? evList(sup) : `<p class="hnote">No explanation reached “plausible” or better here, so nothing is listed as support.</p>`}
      ${weatherBlock()}
    </div></section>

    <section class="sec"><div class="no">04</div><div><h3>Missing evidence</h3>
      <ul class="miss">${(unit.missing_evidence || []).map((m) => `<li>${esc(m)}</li>`).join("")}</ul>
    </div></section>

    <section class="sec"><div class="no">05</div><div><h3>Conclusion</h3>
      <div class="concl"><span class="stamp ${c.status}">${esc(c.label)}</span><p>${esc(c.summary)}</p>
      ${c.reason ? `<p class="why"><b>Why:</b> ${esc(c.reason)}</p>` : ""}
      <p class="fine">Hypotheses are tested against the available data; none is presented as an established cause. This is not a dam-safety or prediction system.</p></div>
    </div></section>`;
  $("#btn-back")?.addEventListener("click", () => selectSector(null));
}

/* ------------------------------------------------------------------ appendix */
function openMethod() { renderMethod(); $("#method").hidden = false; $("#btn-close").focus(); }
function closeMethod() { $("#method").hidden = true; }

function renderMethod() {
  const m = D.meta, st = D.stats, an = D.analysis, body = $("#method-body");
  if (!m) { body.innerHTML = "<p>Metadata not generated yet.</p>"; return; }
  const p = m.nisar.pair, rl = m.nisar.read_log || {};
  const tr = (k, f) => `<tr><th>${k}</th><td class="mono">${f(p.before, "before")}</td><td class="mono">${f(p.after, "after")}</td></tr>`;
  const inv = [...(m.nisar.inventory || [])].sort((a, b) => a.start_time.localeCompare(b.start_time));
  const t0 = Date.parse(inv[0]?.start_time), t1 = Date.parse(inv[inv.length - 1]?.start_time);
  const pos = (t) => (100 * (Date.parse(t) - t0) / Math.max(1, t1 - t0)).toFixed(2);
  const sel = [p.before.start_time, p.after.start_time];
  body.innerHTML = `
    <p>SAR-BRIDGE AI compares two real NASA–ISRO NISAR radar observations of Mingəçevir Reservoir, maps where water appeared or disappeared, and uses a transparent evidence engine plus an LLM to say which environmental explanations the available data support. It performs pairwise change detection only.</p>

    <h3>A · NISAR observations</h3>
    <table class="t"><tr><th></th><th>Before</th><th>After</th></tr>
      ${tr("Acquired (UTC)", (g) => esc(g.start_time))}
      ${tr("Granule", (g) => esc(g.granule_id))}
      ${tr("Collection", (g) => `${esc(g.collection)} · ${esc(g.data_maturity)}`)}
      ${tr("Track · dir · frame", (g) => `${g.track} · ${esc(g.direction)} · ${g.frame}`)}
      ${tr("Polarisations", (g) => `${esc((g.frequency_a_polarizations || []).join(" + "))} · ${esc(g.frequency_a_bandwidth_mhz)} MHz`)}
      ${tr("Version · CRID", (g) => `${esc(g.product_version)} · ${esc(g.crid)}`)}
      ${tr("Orbit", (g) => esc(g.orbit_type))}
      ${tr("Native grid", (g, k) => rl[k]?.native_spacing_m ? `${esc(rl[k].native_spacing_m.map(Math.abs).join(" × "))} m · EPSG:${esc(rl[k].native_epsg)}` : "n/a")}
      ${tr("Granule size", (g) => g.size_mb ? `${num(g.size_mb / 1024, 1)} GB: only the reservoir window was streamed` : "n/a")}
      ${tr("Links", (g) => `<a href="${esc(g.cmr_url)}" target="_blank" rel="noopener">CMR</a> · <a href="${esc(g.qa_report_url)}" target="_blank" rel="noopener">QA report</a>`)}
    </table>
    <p class="small">Why this pair:</p><ul>${m.nisar.selection_rationale.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
    <p class="small">All ${m.nisar.inventory_count} NISAR GCOV acquisitions over the area: grey provisional, green validated, red = the pair used.</p>
    <div class="timeline">${inv.map((r) => `<div class="tk ${r.maturity === "validated" ? "validated" : ""} ${sel.includes(r.start_time) ? "sel" : ""}" style="left:${pos(r.start_time)}%" title="${esc(r.start_time)} · track ${r.track}${esc(r.direction)} · ${esc(r.maturity)}"></div>`).join("")}
      ${sel.map((t) => `<div class="lbl" style="left:${pos(t)}%">${esc(nice(t))}</div>`).join("")}</div>
    <div class="axis"><span>${esc(nice(inv[0]?.start_time))}</span><span>${esc(nice(inv[inv.length - 1]?.start_time))}</span></div>

    <h3>B · Processing</h3>
    <ol>${m.method_steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
    ${st ? `<table class="t"><tr><th>Water threshold</th><th>HH</th><th>HV</th></tr>
      ${["before", "after"].map((k) => {
        const cell = (p) => { const t = st.thresholds[`${k}_${p}`]; return `${t.threshold_db} dB${t.clamped ? ` (Otsu ${t.otsu_raw_db} dB, clamped${t.separable === false ? ": not separable" : ""})` : ""}`; };
        return `<tr><td>${esc(nice(st.pair[k].date))}</td><td class="mono">${cell("HH")}</td><td class="mono">${cell("HV")}</td></tr>`;
      }).join("")}</table>
    ${st.separability ? `<p class="small">Separability rule: if the data-driven Otsu split lies more than ${st.separability.max_clamp_db} dB outside the plausible range, the polarisation is treated as having no usable water/land contrast. Result: HH ${st.separability.HH ? "usable" : "not separable"}, HV ${st.separability.HV ? "usable" : "not separable"}; HV evidence is reported as missing, not as contradiction.</p>` : ""}` : ""}

    ${an ? `<h3>C · Evidence-engine rules</h3>
    <p class="small">Fixed, physically motivated thresholds. Each hypothesis collects evidence items labelled supports / contradicts / neutral / missing; its status follows explicit rules in <span class="mono">pipeline/06_evidence.py</span>.</p>
    <table class="t">${Object.entries(an.rules).map(([k, v]) => `<tr><th>${esc(k.replaceAll("_", " "))}</th><td class="mono">${esc(v)}</td></tr>`).join("")}</table>` : ""}

    <h3>D · Optical cross-check (Sentinel-2)</h3>
    <table class="t"><tr><th>Scene</th><th>UTC</th><th>vs NISAR</th><th>Cloud</th></tr>
      ${Object.values(m.sentinel2.scenes).map((s) => `<tr><td class="mono"><a href="${esc(s.stac_url)}" target="_blank" rel="noopener">${esc(s.item_id)}</a></td><td class="mono">${esc(s.datetime_utc)}</td><td class="mono">${s.days_from_nisar > 0 ? "+" : ""}${num(s.days_from_nisar, 1)} d (${esc(s.paired_nisar)})</td><td class="mono">${num(s.scene_cloud_cover_pct, 1)}%</td></tr>`).join("")}
    </table>
    <p class="small">${esc(m.sentinel2.method)}</p>
    ${(m.sentinel2.processing_notes || []).length ? `<p class="small">Note: the advertised reflectance offset produced negative reflectance for these scenes, so it was not applied (logged per band in <span class="mono">data/context/sentinel2.json</span>).</p>` : ""}

    <h3>E · Sources</h3>
    <table class="t"><tr><th>Dataset</th><th>Provider</th><th>Licence</th></tr>
      ${m.sources.map((s) => `<tr><td><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a></td><td>${esc(s.provider)}</td><td>${esc(s.license)}</td></tr>`).join("")}</table>

    <h3>F · Limitations</h3>
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
  renderTicker();
  renderLedger();
  drawGraticule();
  fromHash();
})();
