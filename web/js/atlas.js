/* Geographic exploration is separate from the versioned radar analysis package. */
"use strict";
window.SBAtlas = (() => {
  const places = [
    {
      id: "mingachevir",
      name: "Mingachevir Reservoir",
      country: "Azerbaijan",
      region: "caucasus",
      type: "Reservoir",
      center: [40.99, 47.03],
      zoom: 10,
      study: true,
      note: "Our first radar case study. Compare two NISAR observations, explore 10 sectors and inspect the independent optical check.",
    },
    {
      id: "shamkir",
      name: "Shamkir Reservoir",
      country: "Azerbaijan",
      region: "caucasus",
      type: "Reservoir",
      center: [40.95, 46.11],
      zoom: 11,
      note: "Explore the Kura River reservoir upstream of Mingachevir.",
    },
    {
      id: "araz",
      name: "Araz Reservoir",
      country: "Azerbaijan / Iran",
      region: "caucasus",
      type: "Reservoir",
      center: [39.1, 45.4],
      zoom: 11,
      note: "Explore the reservoir on the Araz River along the Azerbaijan–Iran border.",
    },
    {
      id: "sevan",
      name: "Lake Sevan",
      country: "Armenia",
      region: "caucasus",
      type: "Lake",
      center: [40.32, 45.35],
      zoom: 9,
      note: "Explore a high-altitude freshwater lake in the South Caucasus.",
    },
    {
      id: "enguri",
      name: "Enguri Reservoir",
      country: "Georgia",
      region: "caucasus",
      type: "Reservoir",
      center: [42.8, 42.04],
      zoom: 11,
      note: "Explore the narrow reservoir along the Enguri River in the western Caucasus.",
    },
    {
      id: "mead",
      name: "Lake Mead",
      country: "United States",
      region: "world",
      type: "Reservoir",
      center: [36.17, -114.43],
      zoom: 9,
      note: "Explore the branching Colorado River reservoir on the Nevada–Arizona border.",
    },
    {
      id: "powell",
      name: "Lake Powell",
      country: "United States",
      region: "world",
      type: "Reservoir",
      center: [37.1, -111.25],
      zoom: 9,
      note: "Explore the Colorado River reservoir and its canyon shoreline in Utah and Arizona.",
    },
    {
      id: "nasser",
      name: "Lake Nasser",
      country: "Egypt / Sudan",
      region: "world",
      type: "Reservoir",
      center: [22.55, 32.25],
      zoom: 7,
      note: "Explore the Nile reservoir extending south from the Aswan High Dam.",
    },
    {
      id: "ataturk",
      name: "Atatürk Reservoir",
      country: "Türkiye",
      region: "world",
      type: "Reservoir",
      center: [37.58, 38.49],
      zoom: 9,
      note: "Explore the Euphrates River reservoir in southeastern Türkiye.",
    },
  ];
  function create({ data, onCase }) {
    const $ = (selector) => document.querySelector(selector);
    const esc = (text) =>
      String(text).replace(
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
    let map,
      tiles,
      region = "all",
      selected = places[0],
      timer;
    const markers = new Map();
    const reduced = () =>
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    function reference(place) {
      return `https://www.openstreetmap.org/#map=${place.zoom}/${place.center[0]}/${place.center[1]}`;
    }
    function renderList() {
      const query = $("#atlas-search").value.trim().toLocaleLowerCase();
      const filtered = places.filter(
        (place) =>
          (region === "all" || place.region === region) &&
          `${place.name} ${place.country} ${place.type}`
            .toLocaleLowerCase()
            .includes(query),
      );
      $("#atlas-count").textContent =
        `${filtered.length} ${filtered.length === 1 ? "place" : "places"} · 1 radar study in the atlas`;
      $("#atlas-list").innerHTML = filtered.length
        ? filtered
            .map(
              (place) =>
                `<button class="atlas-place" type="button" data-place="${place.id}" aria-pressed="${place.id === selected.id}"><span class="atlas-place-head"><strong>${place.name}</strong><span aria-hidden="true">↗</span></span><span>${place.country} <i>·</i> ${place.type}</span><small class="${place.study ? "study-ready" : "preview-only"}">${place.study ? "Radar study available" : "Satellite preview"}</small></button>`,
            )
            .join("")
        : '<p class="atlas-empty">No matching places. Try another name or explore a location by coordinates below.</p>';
      markers.forEach((marker, id) => {
        const visible = filtered.some((place) => place.id === id);
        if (visible && !map.hasLayer(marker)) marker.addTo(map);
        else if (!visible && map.hasLayer(marker)) map.removeLayer(marker);
      });
    }
    function renderDetail() {
      const place = selected;
      $("#atlas-detail").innerHTML =
        `<div><p class="eyebrow">${place.study ? "RADAR CASE STUDY AVAILABLE" : "GEOGRAPHIC EXPLORATION"}</p><h2>${esc(place.name)}</h2><p>${esc(place.country)} <span class="slash">/</span> ${esc(place.type)}</p><p class="atlas-place-description">${esc(place.note)}</p></div><div class="atlas-detail-action">${place.study ? `<span class="atlas-ready"><span class="status-dot"></span> NISAR + Sentinel-2 + ERA5</span><button class="journey-primary" type="button" data-atlas-case>Open radar investigation <span aria-hidden="true">→</span></button><small>${data.stats.pair.before.date} → ${data.stats.pair.after.date}</small>` : `<span class="atlas-preview-status">Satellite preview · analysis not run</span><p>A radar change study needs a matching observation pair, processing and an independent check for this location.</p>`}<a href="${reference(place)}" target="_blank" rel="noopener noreferrer">View reference map ↗</a></div>`;
      $("#atlas-fallback").href = reference(place);
    }
    function choose(id, { animate = true } = {}) {
      selected = places.find((place) => place.id === id) || places[0];
      updateView(animate);
    }
    function updateView(animate) {
      map.stop();
      map.setView(selected.center, selected.zoom, {
        animate: animate && !reduced(),
      });
      markers.forEach((marker, id) =>
        marker.setStyle({
          color: id === selected.id ? "#fff" : "#f2c58d",
          fillColor: id === selected.id ? "#eab16e" : "#102f36",
          radius: id === selected.id ? 9 : 6,
          weight: 2,
          fillOpacity: 1,
        }),
      );
      renderList();
      renderDetail();
      if (document.body.dataset.experience === "atlas") {
        const url = new URL(location.href);
        url.searchParams.set("reservoir", selected.id);
        if (selected.id === "custom") {
          url.searchParams.set("lat", selected.center[0]);
          url.searchParams.set("lng", selected.center[1]);
        } else {
          url.searchParams.delete("lat");
          url.searchParams.delete("lng");
        }
        history.replaceState(null, "", url.pathname + url.search);
      }
    }
    function ensureMap() {
      if (map) return;
      map = L.map("atlas-map", {
        zoomControl: false,
        minZoom: 2,
        maxZoom: 17,
        worldCopyJump: true,
        scrollWheelZoom: false,
      });
      L.control.zoom({ position: "topright" }).addTo(map);
      L.control.scale({ imperial: false, position: "bottomright" }).addTo(map);
      map.attributionControl.setPrefix(false);
      tiles = L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
          attribution:
            "© Esri, Maxar, Earthstar Geographics and the GIS community",
          maxZoom: 18,
        },
      );
      tiles.on("tileerror", () => {
        $("#atlas-map-notice").hidden = false;
      });
      tiles.addTo(map);
      for (const place of places) {
        const marker = L.circleMarker(place.center, {
          radius: 6,
          color: "#f2c58d",
          fillColor: "#102f36",
          fillOpacity: 1,
          weight: 2,
        }).bindTooltip(esc(place.name));
        marker.on("click", () => choose(place.id));
        marker.addTo(map);
        markers.set(place.id, marker);
      }
    }
    function open(id) {
      ensureMap();
      clearTimeout(timer);
      requestAnimationFrame(() => {
        map.invalidateSize({ pan: false });
        const url = new URL(location.href);
        if (!id && url.searchParams.get("reservoir") === "custom") {
          const lat = Number(url.searchParams.get("lat")),
            lng = Number(url.searchParams.get("lng"));
          if (
            url.searchParams.has("lat") &&
            url.searchParams.has("lng") &&
            Number.isFinite(lat) &&
            Number.isFinite(lng) &&
            Math.abs(lat) <= 85 &&
            Math.abs(lng) <= 180
          ) {
            selected = customPlace(lat, lng);
            updateView(false);
            return;
          }
        }
        if (id || url.searchParams.has("reservoir")) {
          region = "all";
          $("#atlas-search").value = "";
          syncFilters();
          choose(id || url.searchParams.get("reservoir"), { animate: false });
        } else updateView(false);
      });
    }
    function customPlace(lat, lng) {
      return {
        id: "custom",
        name: `${lat.toFixed(3)}°, ${lng.toFixed(3)}°`,
        country: "Custom location",
        type: "Map view",
        center: [lat, lng],
        zoom: 11,
        note: "Explore the surrounding satellite imagery. Coordinates select a map location; they do not identify a water boundary.",
      };
    }
    function syncFilters() {
      document
        .querySelectorAll("[data-atlas-region]")
        .forEach((button) =>
          button.setAttribute(
            "aria-pressed",
            String(button.dataset.atlasRegion === region),
          ),
        );
    }
    $("#atlas-list").addEventListener("click", (event) => {
      const button = event.target.closest("[data-place]");
      if (button) choose(button.dataset.place);
    });
    $("#atlas-search").addEventListener("input", renderList);
    document.querySelectorAll("[data-atlas-region]").forEach((button) =>
      button.addEventListener("click", () => {
        region = button.dataset.atlasRegion;
        syncFilters();
        renderList();
      }),
    );
    $("#atlas-detail").addEventListener("click", (event) => {
      if (event.target.closest("[data-atlas-case]")) onCase();
    });
    $("#atlas-fit").addEventListener("click", () =>
      map.setView(selected.center, selected.zoom, { animate: !reduced() }),
    );
    $("#atlas-retry").addEventListener("click", () => {
      $("#atlas-map-notice").hidden = true;
      tiles.redraw();
    });
    $("#atlas-coordinate-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      selected = customPlace(
        Number(form.elements.latitude.value),
        Number(form.elements.longitude.value),
      );
      updateView(true);
    });
    const resize = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (map && document.body.dataset.experience === "atlas")
          map.invalidateSize({ pan: false });
      }, 80);
    });
    resize.observe($("#atlas-map"));
    const loss = data.stats.totals.loss_ha;
    $("#home-loss").textContent = loss.toLocaleString("en-US", {
      maximumFractionDigits: 1,
    });
    $("#home-sectors").textContent = data.stats.n_sectors;
    $("#home-grid").textContent = `${data.stats.parameters.pixel_size_m} m`;
    $("#home-pair").textContent =
      data.stats.pair.before.date + " → " + data.stats.pair.after.date;
    return { open };
  }
  return { create };
})();
