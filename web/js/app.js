/* SAR-BRIDGE AI front end. All data are pre-computed by the Python pipeline (web/data/*). */
"use strict";

const STATUS_TEXT = {
  supported: "Supported hypothesis",
  plausible: "Plausible but unconfirmed",
  insufficient: "Insufficient evidence",
  not_supported: "Not supported by available data",
  no_change: "No significant change detected",
};
const MARK = { supports: "✓", contradicts: "✕", neutral: "–", missing: "?" };
const MARK_LABEL = {
  supports: "supports",
  contradicts: "contradicts",
  neutral: "neutral",
  missing: "missing",
};
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const SEL = "#f1d09a"; // Warm selection stroke remains visible on optical and radar imagery.

const D = {};
const S = { imagery: "S2", slider: 0.5, selected: null };
let map,
  panes = {},
  overlays = {},
  sectorLayer,
  tagLayer,
  polyLayer,
  osmLayer;

/* ------------------------------------------------------------------ utils */
const $ = (s) => document.querySelector(s);
const css = (name) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const num = (x, d = 0) =>
  x === null || x === undefined || Number.isNaN(+x)
    ? "n/a"
    : Number(x).toLocaleString("en-US", {
        maximumFractionDigits: d,
        minimumFractionDigits: d,
      });
const ha = (x) => (x === null || x === undefined ? "n/a" : `${num(x, 1)} ha`);
const pct = (f) =>
  f === null || f === undefined
    ? "n/a"
    : `${num(100 * f, f > 0.999 && f < 1 ? 2 : 1)}%`;
const nice = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${+d} ${MONTHS[+m - 1]} ${y}`;
};

async function loadAll() {
  const { data, warnings } = await SBData.load();
  Object.assign(D, data);
  $("#load-status").textContent = warnings.join(" ");
}
const motionAllowed = () =>
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const activeUnit = () =>
  S.selected === null
    ? D.analysis?.study_area
    : D.analysis?.sectors.find((s) => s.id === S.selected);
const fullBounds = () => D.layers.change_map.bounds;

/* ------------------------------------------------------------------ map */
function initMap() {
  map = L.map("map", {
    zoomControl: false,
    minZoom: 7,
    maxZoom: 16,
    zoomSnap: 0.25,
  });
  L.control.zoom({ position: "topright" }).addTo(map);
  L.tileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    {
      attribution: "Basemap © Esri, Maxar, Earthstar Geographics",
      maxZoom: 18,
    },
  )
    .on("tileerror", () => {
      $("#map-notice").hidden = false;
      $("#map-notice").textContent =
        "Basemap unavailable. Local observation imagery remains available.";
    })
    .addTo(map);
  L.control
    .scale({ imperial: false, position: "bottomright", maxWidth: 120 })
    .addTo(map);
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution(
    "NISAR © NASA/JPL–ISRO via ASF · Sentinel-2 © ESA Copernicus · © OSM contributors",
  );
  [
    ["before", 410],
    ["after", 411],
    ["change", 420],
    ["sectors", 430],
    ["polys", 440],
    ["osm", 445],
  ].forEach(([n, z]) => {
    panes[n] = map.createPane(n);
    panes[n].style.zIndex = z;
  });

  const ly = D.layers || {};
  map.fitBounds(fullBounds(), { padding: [2, 2] });
  for (const [name, spec] of Object.entries(ly)) {
    const pane = name.includes("before")
      ? "before"
      : name.includes("after")
        ? "after"
        : "change";
    overlays[name] = L.imageOverlay(spec.url, spec.bounds, {
      pane,
      interactive: false,
    }).on("error", () => {
      $("#map-notice").hidden = false;
      $("#map-notice").textContent =
        `The ${name.replaceAll("_", " ")} image could not load. Select another imagery layer or reload.`;
    });
  }
  if (D.osm) {
    osmLayer = L.geoJSON(D.osm, {
      pane: "osm",
      style: { color: "#fde68a", weight: 1.5, dashArray: "5 5", fill: false },
      pointToLayer: (f, ll) =>
        L.circleMarker(ll, {
          pane: "osm",
          radius: 5,
          color: "#12201f",
          weight: 2,
          fillColor: "#fde68a",
          fillOpacity: 1,
        }).bindTooltip("Mingachevir dam (OpenStreetMap)", { className: "tt" }),
    });
  }
  if (D.sectors) buildSectors();
  if (D.polys) buildPolys();
  map.on("move zoom zoomend resize viewreset", updateClip);
}

const baseStyle = () => ({
  color: "#ffffff",
  weight: 1,
  opacity: 0.75,
  dashArray: "3 4",
  fill: true,
  fillColor: "#ffffff",
  fillOpacity: 0,
});
const selStyle = () => ({
  color: SEL,
  weight: 3,
  opacity: 1,
  dashArray: null,
  fill: true,
  fillColor: SEL,
  fillOpacity: 0.12,
});

function buildSectors() {
  sectorLayer = L.geoJSON(D.sectors, {
    pane: "sectors",
    style: baseStyle,
    onEachFeature: (f, layer) => {
      const p = f.properties;
      layer.bindTooltip(
        `<b>${esc(p.name)}</b><br>Water loss <span class="num">${ha(p.loss_ha)}</span> · gain <span class="num">${ha(p.gain_ha)}</span><br>Valid data <span class="num">${pct(p.valid_fraction)}</span>`,
        { className: "tt", sticky: true },
      );
      layer.on({
        mouseover: () => {
          if (S.selected !== p.id)
            layer.setStyle({ fillOpacity: 0.08, dashArray: null, opacity: 1 });
        },
        mouseout: () => {
          if (S.selected !== p.id) layer.setStyle(baseStyle());
        },
        click: () => selectSector(p.id),
      });
    },
  });
  tagLayer = L.layerGroup(
    D.sectors.features.map((f) => {
      const p = f.properties;
      return L.marker([p.label_lat, p.label_lon], {
        icon: L.divIcon({
          className: "sector-tag",
          html: `<b>S${p.id}</b>`,
          iconSize: [30, 24],
          iconAnchor: [15, 12],
        }),
        title: p.name,
        pane: "osm",
      }).on("click", () => selectSector(p.id));
    }),
  );
}

function buildPolys() {
  const renderer = L.canvas({ pane: "polys", padding: 0.3 });
  polyLayer = L.geoJSON(D.polys, {
    renderer,
    style: (f) => ({
      color: f.properties.change === "gain" ? "#557f9a" : "#bf643f",
      weight: 1.6,
      opacity: 0,
      fill: true,
      fillOpacity: 0,
    }),
    onEachFeature: (f, layer) => {
      const p = f.properties;
      layer.bindTooltip(
        `<b>${p.change === "gain" ? "Water gain" : "Water loss"}</b> · <span class="num">${ha(p.area_ha)}</span>${p.sector ? ` · Sector ${p.sector}` : ""}`,
        { className: "tt", sticky: true },
      );
      layer.on({
        mouseover: () => layer.setStyle({ opacity: 1 }),
        mouseout: () => layer.setStyle({ opacity: 0 }),
        click: () => p.sector && selectSector(p.sector),
      });
    },
  });
}

/* ------------------------------------------------------------------ imagery & comparison slider */
const imageryKeys = () =>
  S.imagery === "S2"
    ? ["s2_before", "s2_after"]
    : [`nisar_before_${S.imagery}`, `nisar_after_${S.imagery}`];

function dateOf(key) {
  const spec = D.layers?.[key];
  if (spec?.date) return spec.date;
  if (key.startsWith("s2_"))
    return (
      D.meta?.sentinel2?.scenes?.[key.slice(3)]?.datetime_utc?.slice(0, 10) ||
      ""
    );
  return "";
}
function toggle(layer, on) {
  if (!layer) return;
  if (on && !map.hasLayer(layer)) layer.addTo(map);
  if (!on && map.hasLayer(layer)) map.removeLayer(layer);
}

function applyLayers() {
  const [kb, ka] = imageryKeys();
  [
    "nisar_before_HH",
    "nisar_after_HH",
    "nisar_before_HV",
    "nisar_after_HV",
    "s2_before",
    "s2_after",
  ].forEach((k) => toggle(overlays[k], false));
  const compare = $("#chk-slider").checked && !!overlays[kb];
  toggle(overlays[ka], true);
  toggle(overlays[kb], compare);
  const showChange = $("#chk-change").checked;
  toggle(overlays.change_map, showChange);
  toggle(polyLayer, showChange);
  toggle(sectorLayer, $("#chk-sectors").checked);
  toggle(tagLayer, $("#chk-sectors").checked);
  syncSectorTags();
  toggle(osmLayer, $("#chk-osm").checked);

  const sensor = S.imagery === "S2" ? "Sentinel-2" : `NISAR ${S.imagery}`;
  $("#flag-before").innerHTML = `<small>Before</small>${esc(nice(dateOf(kb)))}`;
  $("#flag-after").innerHTML = `<small>After</small>${esc(nice(dateOf(ka)))}`;
  $("#divider").hidden = !compare;
  $("#solo-flag").hidden = compare;
  $("#solo-flag").textContent = overlays[ka]
    ? `${sensor} · ${nice(dateOf(ka))}`
    : "NISAR imagery not processed yet";

  // legend: change classes + the backscatter scale of the imagery on screen
  $("#lg-change").hidden = !showChange;
  const spec = D.layers?.[ka];
  const radar = S.imagery !== "S2" && spec?.vmin_db !== undefined;
  $("#lg-scale").hidden = !radar;
  if (radar) {
    $("#lg-scale-title").innerHTML =
      `Radar backscatter <span class="nocase">γ<sup>0</sup></span> ${S.imagery}`;
    $("#lg-min").textContent = `${spec.vmin_db} dB`;
    $("#lg-max").textContent = `${spec.vmax_db} dB`;
  }
  $("#period-before").textContent = nice(dateOf(kb));
  $("#period-after").textContent = nice(dateOf(ka));
  const days = Math.round(
    (Date.parse(dateOf(ka)) - Date.parse(dateOf(kb))) / 86400000,
  );
  $("#period-duration").textContent = Number.isFinite(days)
    ? `${days} days apart`
    : "";
  $("#imagery-note").textContent =
    S.imagery === "S2"
      ? `Optical context: ${nice(dateOf(kb))} / ${nice(dateOf(ka))}. Change overlay and measurements use NISAR: ${D.stats.pair.before.date} / ${D.stats.pair.after.date}.`
      : `NISAR L-band · ${S.imagery} polarisation · ${D.stats.parameters.pixel_size_m} m grid · Provisional data${S.imagery === "HV" && !D.stats.separability.HV ? ". HV cannot reliably separate water and land in this pair." : "."}`;
  updateClip();
}

function updateClip() {
  if (!map) return;
  const size = map.getSize();
  if ($("#divider").hidden) {
    panes.before.style.clip = panes.after.style.clip = "";
    return;
  }
  const nw = map.containerPointToLayerPoint([0, 0]),
    se = map.containerPointToLayerPoint(size);
  const x = nw.x + size.x * S.slider;
  panes.before.style.clip = `rect(${nw.y}px, ${x}px, ${se.y}px, ${nw.x}px)`;
  panes.after.style.clip = `rect(${nw.y}px, ${se.x}px, ${se.y}px, ${x}px)`;
  $("#divider").style.left = `${size.x * S.slider}px`;
  $("#divider .handle").setAttribute(
    "aria-valuenow",
    Math.round(S.slider * 100),
  );
}

function initSlider() {
  const handle = $("#divider .handle"),
    box = $(".map-area");
  const set = (e) => {
    const r = box.getBoundingClientRect();
    S.slider = Math.min(0.97, Math.max(0.03, (e.clientX - r.left) / r.width));
    updateClip();
  };
  handle.addEventListener("pointerdown", (e) => {
    handle.setPointerCapture(e.pointerId);
    const mv = (ev) => set(ev);
    const up = () => {
      handle.removeEventListener("pointermove", mv);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
    };
    handle.addEventListener("pointermove", mv);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
    e.preventDefault();
  });
  handle.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") S.slider = Math.max(0.03, S.slider - 0.03);
    else if (e.key === "ArrowRight") S.slider = Math.min(0.97, S.slider + 0.03);
    else if (e.key === "Home") S.slider = 0.03;
    else if (e.key === "End") S.slider = 0.97;
    else return;
    e.preventDefault();
    updateClip();
  });
}

function initControls() {
  const buttons = [...document.querySelectorAll("#imagery-seg button")];
  buttons.forEach((b, i) => {
    b.tabIndex = b.classList.contains("on") ? 0 : -1;
    b.addEventListener("click", () => {
      buttons.forEach((x) => {
        x.classList.remove("on");
        x.setAttribute("aria-checked", "false");
        x.tabIndex = -1;
      });
      b.classList.add("on");
      b.setAttribute("aria-checked", "true");
      b.tabIndex = 0;
      S.imagery = b.dataset.img;
      applyLayers();
    });
    b.addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
      e.preventDefault();
      const next =
        buttons[
          (i + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) %
            buttons.length
        ];
      next.click();
      next.focus();
    });
  });
  ["#chk-slider", "#chk-change", "#chk-sectors", "#chk-osm"].forEach((id) =>
    $(id).addEventListener("change", applyLayers),
  );
  $("#chk-osm").disabled = !osmLayer;
  const picker = $("#sector-select");
  picker.innerHTML =
    '<option value="">Whole reservoir</option>' +
    D.analysis.sectors
      .map((s) => `<option value="${s.id}">${esc(s.name)}</option>`)
      .join("");
  picker.disabled = false;
  picker.addEventListener("change", () =>
    selectSector(picker.value ? Number(picker.value) : null),
  );
  $("#btn-method").addEventListener("click", openMethod);
  $("#btn-limitations").addEventListener("click", () => {
    openMethod();
    $("#method-limitations").scrollIntoView({ block: "start" });
  });
  $("#btn-close").addEventListener("click", closeMethod);
  $("#btn-reset").addEventListener("click", () => {
    selectSector(null, { fly: false });
    map.fitBounds(fullBounds(), { padding: [2, 2] });
  });
  $("#btn-export").disabled = false;
  $("#btn-export").addEventListener("click", () =>
    SBReport.download(activeUnit(), D),
  );
  $("#method").addEventListener("click", (e) => {
    if (e.target.id === "method") closeMethod();
  });
  document.addEventListener("keydown", (e) => {
    if ($("#method").hidden) return;
    if (e.key === "Escape") closeMethod();
    if (e.key === "Tab") {
      const focusable = [
        ...$("#method").querySelectorAll(
          'button, a[href], input, select, [tabindex="0"]',
        ),
      ].filter((el) => el.getClientRects().length);
      const first = focusable[0],
        last = focusable.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  });
  document.addEventListener("click", (e) => {
    const menu = $(".layer-menu");
    if (!menu.contains(e.target)) menu.open = false;
  });
  window.addEventListener("hashchange", fromHash);
  new ResizeObserver(() => {
    if (!$("#map").clientWidth) return;
    map.invalidateSize({ pan: false });
    if (S.selected === null)
      map.fitBounds(fullBounds(), { padding: [2, 2], animate: false });
    $(".panel").style.height =
      window.innerWidth > 900 ? `${$(".map-column").offsetHeight}px` : "";
    $("#journey-panel").style.height =
      window.innerWidth > 900 ? `${$(".map-column").offsetHeight}px` : "";
    drawProfile();
    updateClip();
  }).observe($(".map-column"));
}

/* ------------------------------------------------------------------ observation summary */
function renderContext() {
  $("#data-status").textContent = `Data · ${nice(D.stats.generated_utc)}`;
  $("#sector-count").textContent =
    `${D.stats.n_sectors} sectors · ${num(D.stats.reservoir_axis_length_km, 1)} km`;
}
function renderSummary() {
  const st = D.stats,
    t = st.totals;
  const agreement = t.optical?.after_mask_agreement;
  const icon = (path) =>
    `<span class="stat-icon"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="${path}"/></svg></span>`;
  $("#stats").innerHTML = `
    <div class="stat loss">${icon("m3 5 5 5 4-3 5 8m-6 0h6V9")}<div class="k">Radar-indicated loss</div><div class="v">${num(t.loss_ha, 1)}<small>ha</small></div><div class="s">Radar-detected water → land</div></div>
    <div class="stat gain">${icon("m3 15 6-6 3 3 5-8m-6 0h6v6")}<div class="k">Radar-indicated gain</div><div class="v">${num(t.gain_ha, 1)}<small>ha</small></div><div class="s">Radar-detected land → water</div></div>
    <div class="stat">${icon("m4 10 4 4 8-9")}<div class="k">Valid radar coverage</div><div class="v">${num(100 * t.valid_fraction, 2)}<small>%</small></div><div class="s">${ha(t.insufficient_data_ha)} with insufficient data</div></div>
    <div class="stat">${icon("m3 7 7-4 7 4-7 4-7-4Zm0 4 7 4 7-4M3 15l7 4 7-4")}<div class="k">Water-mask agreement</div><div class="v">${Number.isFinite(agreement) ? `${num(100 * agreement, 1)}<small>%</small>` : "n/a"}</div><div class="s">${Number.isFinite(agreement) ? `Not change accuracy. Same-day mask · ${nice(st.pair.after.date)}` : "Independent optical comparison unavailable"}</div></div>`;
  $("#stats").setAttribute("aria-busy", "false");
}

/* ------------------------------------------------------------------ sector chart */
function drawProfile() {
  const host = $("#profile");
  const secs = D.analysis?.sectors;
  if (!secs || !D.sectors) {
    host.innerHTML = `<div class="empty">The chart appears after NISAR processing.</div>`;
    return;
  }
  const col = {
    gain: css("--gain"),
    loss: css("--loss"),
    fg: css("--fg"),
    muted: css("--muted"),
    faint: css("--faint"),
    line: css("--line-strong"),
    surface: css("--surface"),
  };
  const W = Math.max(300, host.clientWidth),
    H = host.clientHeight || 150;
  const padL = 40,
    padR = 4,
    top = 8,
    bottom = 22;
  const anyGain = secs.some((s) => s.detected_change.gain_ha > 0),
    anyLoss = secs.some((s) => s.detected_change.loss_ha > 0);
  const usable = H - top - bottom;
  const mid = top + (anyGain && anyLoss ? usable / 2 : anyGain ? usable : 0);
  const amp = anyGain && anyLoss ? usable / 2 : usable;
  const n = secs.length,
    cw = (W - padL - padR) / n,
    bw = Math.min(26, cw * 0.62);
  const raw = Math.max(
    1,
    ...secs.map((s) =>
      Math.max(s.detected_change.gain_ha, s.detected_change.loss_ha),
    ),
  );
  const step = raw > 200 ? 100 : raw > 80 ? 50 : raw > 20 ? 10 : 5;
  const maxv = Math.ceil(raw / step) * step;
  const y = (v, dir) =>
    dir === "gain" ? mid - (v / maxv) * amp : mid + (v / maxv) * amp;

  let grid = "";
  for (let v = step; v <= maxv; v += step) {
    if (anyLoss)
      grid += `<line x1="${padL}" x2="${W - padR}" y1="${y(v, "loss")}" y2="${y(v, "loss")}" stroke="${col.line}" stroke-width=".6" stroke-dasharray="2 3" opacity=".7"/>
      <text x="${padL - 6}" y="${y(v, "loss") + 3.5}" font-size="10" text-anchor="end" fill="${col.faint}">−${num(v)}</text>`;
    if (anyGain)
      grid += `<line x1="${padL}" x2="${W - padR}" y1="${y(v, "gain")}" y2="${y(v, "gain")}" stroke="${col.line}" stroke-width=".6" stroke-dasharray="2 3" opacity=".7"/>
      <text x="${padL - 6}" y="${y(v, "gain") + 3.5}" font-size="10" text-anchor="end" fill="${col.faint}">+${num(v)}</text>`;
  }
  let bars = "";
  secs.forEach((s, i) => {
    const x = padL + i * cw,
      cx = x + cw / 2,
      dc = s.detected_change;
    const hg = (dc.gain_ha / maxv) * amp,
      hl = (dc.loss_ha / maxv) * amp;
    const insuf =
      s.conclusion.status === "insufficient" && !s.significant_change;
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
    el.addEventListener("click", () =>
      selectSector(S.selected === id ? null : id),
    );
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        selectSector(S.selected === id ? null : id);
      }
    });
  });
}

/* ------------------------------------------------------------------ analysis card */
function syncSectorTags() {
  tagLayer?.eachLayer((marker) => {
    marker
      .getElement()
      ?.classList.toggle(
        "selected",
        marker.options.title ===
          D.analysis.sectors.find((s) => s.id === S.selected)?.name,
      );
  });
}
function selectSector(id, { fly = true, scroll = true } = {}) {
  if (id !== null && !D.analysis.sectors.some((s) => s.id === id)) id = null;
  const changed = S.selected !== id;
  $("#sector-select").value = id === null ? "" : String(id);
  S.selected = id;
  if (sectorLayer)
    sectorLayer.eachLayer((l) => {
      const sel = l.feature.properties.id === id;
      l.setStyle(sel ? selStyle() : baseStyle());
      if (sel) {
        l.bringToFront();
        if (fly && changed)
          map.flyToBounds(l.getBounds(), {
            padding: [60, 60],
            duration: motionAllowed() ? 0.7 : 0,
            maxZoom: 12,
          });
      }
    });
  if (id === null && fly && changed && D.layers?.change_map)
    map.flyToBounds(D.layers.change_map.bounds, {
      padding: [10, 10],
      duration: motionAllowed() ? 0.7 : 0,
    });
  syncSectorTags();
  const unit =
    id === null
      ? D.analysis?.study_area
      : D.analysis?.sectors.find((s) => s.id === id);
  renderCard(unit, id);
  drawProfile();
  const h = id === null ? "" : `#sector-${id}`;
  if (location.hash !== h && location.hash !== "#method")
    history.replaceState(null, "", h || location.pathname + location.search);
  if (changed)
    document.dispatchEvent(
      new CustomEvent("sar:sector-selected", { detail: { id } }),
    );
  if (scroll && window.innerWidth <= 900 && id !== null && changed)
    $(".panel").scrollIntoView({
      behavior: motionAllowed() ? "smooth" : "auto",
      block: "start",
    });
}
function fromHash() {
  if (location.hash === "#method") {
    selectSector(null, { fly: false });
    openMethod();
    return;
  }
  const m = location.hash.match(/^#sector[-=](\d+)$/);
  selectSector(m ? Number(m[1]) : null);
}

const evList = (items) =>
  `<ul class="ev">${items.map((e) => `<li><span class="mk ${e.direction}" title="${MARK_LABEL[e.direction]}" aria-label="${MARK_LABEL[e.direction]}">${MARK[e.direction]}</span><span>${esc(e.statement)}<span class="src">${esc(e.source)}</span></span></li>`).join("")}</ul>`;
const kv = (k, v, cls = "") => `<dt>${k}</dt><dd class="${cls}">${v}</dd>`;

function contextBlock() {
  const w = D.meta?.weather?.points?.reservoir,
    up = D.meta?.weather?.points?.upstream;
  if (!w) return "";
  const a = w.acquisitions,
    b = w.between,
    ser = w.daily_series;
  let spark = "";
  if (ser) {
    const t0 = a.before.time_utc.slice(0, 10),
      t1 = a.after.time_utc.slice(0, 10);
    const idx = ser.dates
      .map((d, i) => [d, i])
      .filter(([d]) => d >= t0 && d <= t1)
      .map(([, i]) => i);
    const vals = idx.map((i) => ser.precipitation_sum_mm[i] ?? 0),
      max = Math.max(5, ...vals),
      bw = 100 / vals.length;
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

const SHORT_HYPOTHESIS = {
  water_level: "Reservoir water-level decline",
  seasonal: "Seasonal water-level variation",
  hydropower: "Hydropower-related release",
  vegetation: "Vegetation on exposed margins",
  wind: "Wind effects on radar",
  soil_moisture: "Soil moisture and land surface",
  calibration: "Radar calibration difference",
};
function hypothesisHTML(h, i) {
  return `<details class="hyp"><summary><span class="r">${String(i + 1).padStart(2, "0")}</span><span class="t">${esc(SHORT_HYPOTHESIS[h.id] || h.title)}</span><span class="chip ${esc(h.status)}">${esc(h.status_label || STATUS_TEXT[h.status])}</span></summary>
    <div class="body"><p class="h-why">${esc(h.title)}</p>${h.reason ? `<p class="h-why">${esc(h.reason)}</p>` : ""}${h.note ? `<p class="h-note">${esc(h.note)}</p>` : ""}${evList(h.evidence || [])}</div></details>`;
}
function renderCard(unit, id) {
  const el = $("#analysis-card");
  if (!unit) return;
  const dc = unit.detected_change,
    c = unit.conclusion,
    ai = unit.ai_explanation,
    hyps = unit.significant_change ? unit.hypotheses || [] : [];
  const isTotal = id === null;
  const paras =
    ai?.text
      .split(/\n\s*\n/)
      .map((p) => `<p>${esc(p.trim())}</p>`)
      .join("") || "";
  let aiMeta = "";
  if (ai?.source === "openai") {
    aiMeta = `<span>Language model: ${esc(ai.model)}. Interpretation of precomputed evidence.</span><span class="${ai.numbers_verified ? "ok" : "warn"}">${ai.numbers_verified ? "Numbers checked against the measurements." : "Some numbers could not be verified."}</span>`;
  } else if (ai) {
    aiMeta = `<span class="warn">${ai.rejected_llm_draft ? "The language-model draft did not pass validation. Showing an evidence-engine template." : "Evidence-engine template. No language model was used for this report."}</span>`;
  }
  const preview = {
    insufficient:
      "The available evidence is too weak or conflicting to establish an explanation. Explore the evidence and missing observations below.",
    plausible:
      "The leading explanation is consistent with some observations. Independent evidence is still needed before drawing a stronger conclusion.",
    supported:
      "Independent observations support the leading hypothesis. This is evidence of consistency, rather than proof of the underlying cause.",
    no_change:
      "The measured differences do not meet the evidence engine’s significance rule. No environmental cause is assigned to this sector.",
    not_supported:
      "The available observations point against the leading explanation. Review the evidence before interpreting this change.",
  }[c.status];
  const ledger = hyps[0]?.evidence || unit.supporting_evidence || [];
  const counts = { supports: 0, contradicts: 0, missing: 0 };
  ledger.forEach((e) => {
    if (e.direction in counts) counts[e.direction]++;
  });
  const dominantLoss = dc.loss_ha >= dc.gain_ha;
  el.innerHTML = `
    <div class="card-head"><div><h3>${esc(isTotal ? "Whole reservoir" : unit.name)}</h3><p class="card-sub">${esc(isTotal ? `${D.stats.n_sectors} sectors combined · NISAR HH` : unit.position || "Selected map sector · NISAR HH")}</p></div>${isTotal ? "" : '<button class="link-btn" id="btn-back" type="button">All sectors</button>'}</div>
    <div class="measurement"><div class="measurement-label">Radar-indicated change · ${nice(dc.dates[0])} → ${nice(dc.dates[1])}</div><div class="measurement-value ${!unit.significant_change ? "stable" : dominantLoss ? "" : "gain"}">${unit.significant_change ? `${num(dominantLoss ? dc.loss_ha : dc.gain_ha, 1)} ha water ${dominantLoss ? "loss" : "gain"}` : "No significant change"}</div><div class="measurement-detail"><span>Loss ${ha(dc.loss_ha)} · Gain ${ha(dc.gain_ha)}</span><span>${pct(dc.valid_fraction)} valid</span></div></div>
    <div class="verdict"><div class="verdict-top"><span class="chip ${esc(c.status)}">${esc(c.label)}</span></div><p class="why">${esc(preview || c.reason)}</p></div>
    ${
      hyps.length
        ? `<details class="report-details possible-explanations"><summary>Possible explanations <span class="ledger-count">Ranked by evidence</span></summary><div class="detail-body">${hyps.slice(0, 3).map(hypothesisHTML).join("")}${
            hyps.length > 3
              ? `<details class="report-details more-hypotheses"><summary>${hyps.length - 3} other explanations</summary><div class="detail-body">${hyps
                  .slice(3)
                  .map((h, i) => hypothesisHTML(h, i + 3))
                  .join("")}</div></details>`
              : ""
          }</div></details>`
        : ""
    }
    <details class="report-details"><summary>Evidence ledger <span class="ledger-count">${counts.supports} support · ${counts.contradicts} conflict</span></summary><div class="detail-body"><p class="fine" style="margin-top:0;margin-bottom:12px">${hyps[0] ? `Evidence for the leading hypothesis: ${esc(hyps[0].title)}.` : "Available observations for this area."} Supporting observations alone do not establish a cause.</p>${ledger.length ? evList(ledger) : '<p class="fine">No hypothesis-specific evidence is available for this area.</p>'}${c.reason ? `<p class="fine">Engine verdict: ${esc(c.reason)}</p>` : ""}</div></details>
    <details class="report-details"><summary>Missing evidence <span class="ledger-count">${unit.missing_evidence?.length || 0} gaps</span></summary><div class="detail-body"><ul class="miss">${(unit.missing_evidence || []).map((m) => `<li>${esc(m)}</li>`).join("")}</ul></div></details>
    <details class="report-details"><summary>Plain-language interpretation</summary><div class="detail-body"><div class="ai-box">${ai ? `${paras}<div class="ai-meta">${aiMeta}</div>` : "<p>No plain-language report was generated for this area. The evidence-engine conclusion is shown above.</p>"}</div></div></details>
    <details class="report-details"><summary>Measurement details &amp; weather</summary><div class="detail-body"><p class="what">${esc(dc.what)}</p><dl class="kv">${kv("Water lost", ha(dc.loss_ha), "loss")}${kv("Water gained", ha(dc.gain_ha), "gain")}${kv("Net change", `${dc.net_change_ha > 0 ? "+" : ""}${ha(dc.net_change_ha)}`)}${kv(`Radar-dark · ${nice(dc.dates[0])}`, ha(dc.water_before_ha))}${kv(`Radar-dark · ${nice(dc.dates[1])}`, ha(dc.water_after_ha))}${kv("Valid on both dates", pct(dc.valid_fraction))}</dl><p class="fine">Radar-dark area includes smooth ground and is not a measurement of true water area. Change requires a land/water flip and an HH signal shift of at least ${D.stats.parameters.min_delta_db} dB.</p>${contextBlock()}</div></details>

    <p class="fine report-disclaimer">Pairwise observation, not a forecast. Operational explanations require water-level and release records.</p>`;
  $("#analysis-review").innerHTML =
    `<div class="human-review-callout"><span>Human review</span><strong class="human-state pending" data-human-status="${id === null ? "reservoir" : `sector-${id}`}">Awaiting human review</strong><button type="button" data-review-open="review">Review this area</button><button type="button" data-review-open="validation">Inspect validation</button></div>`;
  el.setAttribute("aria-busy", "false");
  $("#btn-back")?.addEventListener("click", () => selectSector(null));
  $("#btn-export").setAttribute(
    "aria-label",
    `Export report for ${isTotal ? "whole reservoir" : unit.name}`,
  );
  SBReview.refreshBadges();
  el.scrollTop = 0;
}

/* ------------------------------------------------------------------ method sheet */
let methodOpener;
function openMethod() {
  if (!$("#method").hidden) return;
  methodOpener = document.activeElement;
  renderMethod();
  $("#method").hidden = false;
  $(".sheet").scrollTop = 0;
  $("#workspace").inert = true;
  $(".topbar").inert = true;
  document.body.style.overflow = "hidden";
  $("#btn-close").focus();
}
function closeMethod() {
  if ($("#method").hidden) return;
  $("#method").hidden = true;
  $("#workspace").inert = false;
  $(".topbar").inert = false;
  document.body.style.overflow = "";
  if (methodOpener?.isConnected) methodOpener.focus();
  if (location.hash === "#method")
    history.replaceState(null, "", location.pathname + location.search);
}

function renderMethod() {
  const m = D.meta,
    st = D.stats,
    an = D.analysis,
    body = $("#method-body");
  if (!m) {
    body.innerHTML = "<p>Metadata has not been generated yet.</p>";
    return;
  }
  const p = m.nisar.pair,
    rl = m.nisar.read_log || {};
  const tr = (k, f) =>
    `<tr><th>${k}</th><td class="mono">${f(p.before, "before")}</td><td class="mono">${f(p.after, "after")}</td></tr>`;
  const inv = [...(m.nisar.inventory || [])].sort((a, b) =>
    a.start_time.localeCompare(b.start_time),
  );
  const t0 = Date.parse(inv[0]?.start_time),
    t1 = Date.parse(inv[inv.length - 1]?.start_time);
  const pos = (t) =>
    ((100 * (Date.parse(t) - t0)) / Math.max(1, t1 - t0)).toFixed(2);
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
      ${tr("Native grid", (g, k) => (rl[k]?.native_spacing_m ? `${esc(rl[k].native_spacing_m.map(Math.abs).join(" × "))} m, EPSG:${esc(rl[k].native_epsg)}` : "n/a"))}
      ${tr("Granule size", (g) => (g.size_mb ? `${num(g.size_mb / 1024, 1)} GB (only the reservoir window was streamed)` : "n/a"))}
      ${tr("Links", (g) => `<a href="${esc(g.cmr_url)}" target="_blank" rel="noopener">CMR record</a> · <a href="${esc(g.qa_report_url)}" target="_blank" rel="noopener">QA report</a>`)}
    </table></div>
    <p class="small">Why this pair:</p><ul>${m.nisar.selection_rationale.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
    <p class="small">All ${m.nisar.inventory_count} NISAR GCOV acquisitions over the area. Grey: provisional, green: validated, dark green: the pair used.</p>
    <div class="timeline">${inv.map((r) => `<div class="tk ${r.maturity === "validated" ? "validated" : ""} ${sel.includes(r.start_time) ? "sel" : ""}" style="left:${pos(r.start_time)}%" title="${esc(r.start_time)}, track ${r.track}${esc(r.direction)}, ${esc(r.maturity)}"></div>`).join("")}
      ${sel.map((t) => `<div class="lbl" style="left:${pos(t)}%">${esc(nice(t))}</div>`).join("")}</div>
    <div class="tl-axis"><span>${esc(nice(inv[0]?.start_time))}</span><span>${esc(nice(inv[inv.length - 1]?.start_time))}</span></div>

    <h3>Processing</h3>
    <ol>${m.method_steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
    ${
      st
        ? `<div class="tbl"><table class="t"><tr><th>Water threshold</th><th>HH</th><th>HV</th></tr>
      ${["before", "after"]
        .map((k) => {
          const cell = (pp) => {
            const t = st.thresholds[`${k}_${pp}`];
            return `${t.threshold_db} dB${t.clamped ? ` (Otsu ${t.otsu_raw_db} dB, clamped${t.separable === false ? "; not separable" : ""})` : ""}`;
          };
          return `<tr><td>${esc(nice(st.pair[k].date))}</td><td class="mono">${cell("HH")}</td><td class="mono">${cell("HV")}</td></tr>`;
        })
        .join("")}</table></div>
      ${st.separability ? `<p class="small">If the data-driven Otsu split falls more than ${st.separability.max_clamp_db} dB outside the plausible range, that polarisation is treated as having no usable water/land contrast. Here HH is ${st.separability.HH ? "usable" : "not separable"} and HV is ${st.separability.HV ? "usable" : "not separable"}, so HV checks are reported as missing evidence rather than as contradictions.</p>` : ""}`
        : ""
    }

    ${
      an
        ? `<h3>Evidence-engine rules</h3>
      <p class="small">Fixed, physically motivated thresholds. Each explanation collects evidence labelled supports, contradicts, neutral or missing, and its status follows explicit rules in <span class="mono">pipeline/06_evidence.py</span>.</p>
      <div class="tbl"><table class="t">${Object.entries(an.rules)
        .map(
          ([k, v]) =>
            `<tr><th>${esc(k.replaceAll("_", " "))}</th><td class="mono">${esc(v)}</td></tr>`,
        )
        .join("")}</table></div>`
        : ""
    }

    <h3>Optical cross-check (Sentinel-2)</h3>
    <div class="tbl"><table class="t"><tr><th>Scene</th><th>Acquired (UTC)</th><th>Offset from NISAR</th><th>Cloud</th></tr>
      ${Object.values(m.sentinel2.scenes)
        .map(
          (s) =>
            `<tr><td class="mono"><a href="${esc(s.stac_url)}" target="_blank" rel="noopener">${esc(s.item_id)}</a></td><td class="mono">${esc(s.datetime_utc)}</td><td class="mono">${s.days_from_nisar > 0 ? "+" : ""}${num(s.days_from_nisar, 1)} d (${esc(s.paired_nisar)})</td><td class="mono">${num(s.scene_cloud_cover_pct, 1)}%</td></tr>`,
        )
        .join("")}
    </table></div>
    <p class="small">${esc(m.sentinel2.method)}</p>
    ${(m.sentinel2.processing_notes || []).length ? `<p class="small">The reflectance offset listed in the scene metadata produced negative reflectance for these scenes, so it was not applied. Each case is logged in <span class="mono">data/context/sentinel2.json</span>.</p>` : ""}

    <h3>Data sources</h3>
    <div class="tbl"><table class="t"><tr><th>Dataset</th><th>Provider</th><th>Licence</th></tr>
      ${m.sources.map((s) => `<tr><td><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a></td><td>${esc(s.provider)}</td><td>${esc(s.license)}</td></tr>`).join("")}</table></div>

    <h3 id="method-limitations" style="scroll-margin-top:110px">Limitations</h3>
    <ul>${m.limitations.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
    <p class="small">Generated ${esc(m.generated_utc)}.</p>`;
}

/* ------------------------------------------------------------------ boot */
(async function boot() {
  try {
    await loadAll();
    if (!window.L)
      throw new Error(
        "The local map library could not load. Check the web/vendor/leaflet files.",
      );
    initMap();
    initSlider();
    initControls();
    applyLayers();
    renderContext();
    renderSummary();
    fromHash();
    SBReview.create({
      data: D,
      activeUnit: () =>
        document.body.dataset.experience === "dashboard"
          ? D.analysis.study_area
          : activeUnit(),
      selectSector,
    });
    const overview = SBDashboard.create({
      data: D,
      openMap(id) {
        $("#btn-workspace").click();
        requestAnimationFrame(() => {
          selectSector(id, { fly: false, scroll: false });
          const layer = sectorLayer
            .getLayers()
            .find((item) => item.feature.properties.id === id);
          map.fitBounds(layer ? layer.getBounds() : fullBounds(), {
            padding: [35, 35],
            maxZoom: 12,
            animate: false,
          });
          $(".map-area").scrollIntoView({
            behavior: motionAllowed() ? "smooth" : "auto",
            block: "start",
          });
          $("#map").focus({ preventScroll: true });
        });
      },
    });
    SBJourney.create({
      data: D,
      overview,
      scene(options) {
        if (options.imagery) {
          S.imagery = options.imagery;
          document.querySelectorAll("#imagery-seg button").forEach((button) => {
            const selected = button.dataset.img === options.imagery;
            button.classList.toggle("on", selected);
            button.setAttribute("aria-checked", String(selected));
            button.tabIndex = selected ? 0 : -1;
          });
        }
        for (const [key, id] of [
          ["compare", "#chk-slider"],
          ["change", "#chk-change"],
          ["sectors", "#chk-sectors"],
          ["outline", "#chk-osm"],
        ]) {
          if (key in options) $(id).checked = options[key];
        }
        if ("position" in options) S.slider = options.position;
        applyLayers();
        if ("sector" in options)
          selectSector(options.sector, { fly: false, scroll: false });
      },
      select: selectSector,
      fit({ animate = false, preserveView = false } = {}) {
        map.invalidateSize({ pan: false });
        const height = $(".map-column").offsetHeight;
        $(".panel").style.height = window.innerWidth > 900 ? `${height}px` : "";
        $("#journey-panel").style.height =
          window.innerWidth > 900 ? `${height}px` : "";
        if (preserveView) return;
        let bounds = fullBounds();
        sectorLayer.eachLayer((layer) => {
          if (layer.feature.properties.id === S.selected)
            bounds = layer.getBounds();
        });
        map.stop();
        const options = {
          padding: S.selected === null ? [2, 2] : [45, 45],
          maxZoom: 12,
        };
        if (animate) map.flyToBounds(bounds, { ...options, duration: 0.9 });
        else map.fitBounds(bounds, { ...options, animate: false });
      },
      split(position) {
        S.slider = position;
        updateClip();
      },
      reducedMotion: () => !motionAllowed(),
    });
    document.documentElement.dataset.ready = "true";
  } catch (error) {
    const status = $("#load-status");
    document.body.dataset.experience = "error";
    status.classList.add("error");
    status.setAttribute("role", "alert");
    status.innerHTML = `<strong>Observation workspace unavailable.</strong> ${esc(error.message)} <button class="btn" id="btn-retry" type="button">Try again</button>`;
    $("#btn-retry").addEventListener("click", () => location.reload());
    $("#stats").setAttribute("aria-busy", "false");
    $("#analysis-card").setAttribute("aria-busy", "false");
    $("#analysis-card").innerHTML =
      '<p class="loading-copy">The report will appear when a complete observation package is available.</p>';
    $("#stats").innerHTML =
      '<div class="summary-loading">Measurements are unavailable. No estimated or substitute values are displayed.</div>';
    $("#data-status").textContent = "Data unavailable";
    $(".toolbar").hidden = true;
    $("#divider").hidden = true;
    $("#legend").hidden = true;
    $("#btn-reset").hidden = true;
    $("#map").innerHTML =
      '<div class="map-empty"><strong>Observation imagery unavailable</strong><span>Restore the data package and try again.</span></div>';
    $("#profile").innerHTML =
      '<p class="empty">Sector measurements are unavailable.</p>';
  }
})();
