/* Contract between the offline Python pipeline and the static workspace. */
"use strict";
window.SBData = (() => {
  const files = {
    layers: "data/layers.json",
    stats: "data/stats.json",
    analysis: "data/analysis.json",
    meta: "data/meta.json",
    sectors: "data/sectors.geojson",
    polys: "data/change_polygons.geojson",
    osm: "data/reservoir_osm.geojson",
  };
  const required = new Set(["layers", "stats", "analysis", "meta", "sectors"]);
  function validate(data) {
    const { stats, analysis, layers, sectors, meta } = data;
    if (
      !stats?.totals ||
      !Array.isArray(analysis?.sectors) ||
      !analysis.study_area?.detected_change ||
      !Array.isArray(sectors?.features) ||
      !meta?.nisar?.pair
    ) {
      throw new Error(
        "The observation package is incomplete. Regenerate the pipeline exports.",
      );
    }
    const ids = analysis.sectors.map((s) => s.id);
    if (
      !ids.length ||
      new Set(ids).size !== ids.length ||
      new Set(sectors.features.map((f) => f.properties.id)).size !==
        ids.length ||
      ids.length !== stats.n_sectors ||
      sectors.features.length !== ids.length ||
      sectors.features.some((f) => !ids.includes(f.properties.id))
    ) {
      throw new Error(
        "The map sectors and analysis belong to different exports.",
      );
    }
    for (const unit of [analysis.study_area, ...analysis.sectors]) {
      if (
        !unit.conclusion?.label ||
        !unit.conclusion?.status ||
        !unit.detected_change ||
        !["gain_ha", "loss_ha", "net_change_ha", "valid_fraction"].every((k) =>
          Number.isFinite(unit.detected_change[k]),
        ) ||
        ![...Object.keys(analysis.status_labels || {}), "no_change"].includes(
          unit.conclusion.status,
        )
      ) {
        throw new Error(
          "A sector report is missing its measurements or evidence verdict.",
        );
      }
      if (
        unit.detected_change.dates?.length !== 2 ||
        !unit.detected_change.dates.every(
          (d, i) => d === stats.pair[i ? "after" : "before"].date,
        )
      ) {
        throw new Error(
          "The measurements and evidence use different observation dates.",
        );
      }
      if (unit.id !== undefined) {
        const props = sectors.features.find(
          (f) => f.properties.id === unit.id,
        ).properties;
        if (
          ["gain_ha", "loss_ha", "valid_fraction"].some(
            (k) =>
              !Number.isFinite(props[k]) ||
              Math.abs(props[k] - unit.detected_change[k]) > 0.001,
          )
        ) {
          throw new Error(
            "The map tooltip and sector report measurements do not match.",
          );
        }
      }
    }
    for (const k of ["gain_ha", "loss_ha"]) {
      const total = stats.totals[k];
      if (
        !Number.isFinite(total) ||
        Math.abs(total - analysis.study_area.detected_change[k]) > 0.11 ||
        Math.abs(
          total -
            analysis.sectors.reduce((sum, s) => sum + s.detected_change[k], 0),
        ) >
          ids.length * 0.11
      ) {
        throw new Error(
          "The overview and sector measurements do not match. Regenerate the exports together.",
        );
      }
    }
    for (const key of ["change_map", "nisar_before_HH", "nisar_after_HH"]) {
      if (!layers[key]?.url || !layers[key]?.bounds)
        throw new Error("The radar imagery manifest is incomplete.");
    }
    for (const side of ["before", "after"]) {
      if (
        meta.nisar.pair[side]?.start_time?.slice(0, 10) !==
        stats.pair[side].date
      ) {
        throw new Error(
          "Observation provenance does not match the measurements.",
        );
      }
    }
  }
  async function load() {
    const failures = [];
    const entries = await Promise.all(
      Object.entries(files).map(async ([key, url]) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
          const response = await fetch(url, {
            cache: "no-cache",
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return [key, await response.json()];
        } catch {
          failures.push(key);
          return [key, null];
        } finally {
          clearTimeout(timeout);
        }
      }),
    );
    const critical = failures.filter((key) => required.has(key));
    if (critical.length)
      throw new Error(
        `Could not load ${critical.map((k) => files[k]).join(", ")}. Check that the web server and pipeline exports are available.`,
      );
    const data = Object.fromEntries(entries);
    validate(data);
    return {
      data,
      warnings: failures.map(
        (k) => `${files[k]} is unavailable; its optional map layer is hidden.`,
      ),
    };
  }
  return { load, validate };
})();
