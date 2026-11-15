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
    validation: "data/validation.json",
    evaluation: "data/evaluation.json",
  };
  const required = new Set([
    "layers",
    "stats",
    "analysis",
    "meta",
    "sectors",
    "validation",
    "evaluation",
  ]);
  function validate(data) {
    const evaluation = data.evaluation;
    if (
      evaluation?.schema_version !== 1 ||
      evaluation.source !== "team_reported" ||
      evaluation.scope !== "project_summary" ||
      !["f1", "precision", "recall"].every(
        (key) =>
          Number.isFinite(evaluation[key]) &&
          evaluation[key] >= 0 &&
          evaluation[key] <= 1,
      )
    ) {
      throw new Error(
        "The team-reported evaluation summary is missing or invalid.",
      );
    }
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
    validateComparison(data);
  }
  function validateComparison({ validation: v, stats, analysis }) {
    if (
      !v ||
      v.schema_version !== 1 ||
      !/^[a-f0-9]{64}$/.test(v.package_id || "") ||
      v.ground_truth_validated !== false ||
      v.reference_type !== "independent_optical_proxy" ||
      !Array.isArray(v.sectors) ||
      v.sectors.length !== analysis.sectors.length ||
      new Set(v.sectors.map((s) => s.id)).size !== v.sectors.length ||
      !Array.isArray(v.radar_dates) ||
      v.radar_dates.length !== 2 ||
      !v.radar_dates.every(
        (d, i) => d === analysis.study_area.detected_change.dates[i],
      ) ||
      !["stats", "analysis"].every((key) =>
        /^[a-f0-9]{64}$/.test(v.source?.[`${key}_sha256`] || ""),
      ) ||
      !v.optical_scenes?.before?.datetime_utc ||
      !v.optical_scenes?.after?.datetime_utc ||
      !Array.isArray(v.limitations) ||
      !Number.isFinite(v.method?.grid_m) ||
      v.method.grid_m <= 0
    ) {
      throw new Error(
        "The optical-proxy comparison package is incomplete or uses different observations.",
      );
    }
    const safeRatio = (a, b) => (b ? a / b : null);
    for (const item of [v.study_area, ...v.sectors]) {
      const unit =
        item?.id === null
          ? analysis.study_area
          : analysis.sectors.find((s) => s.id === item?.id);
      if (
        !unit ||
        !Number.isInteger(item.common_valid_px) ||
        item.common_valid_px < 0 ||
        !Number.isFinite(item.common_valid_ha) ||
        item.common_valid_ha < 0 ||
        !Number.isFinite(item.excluded_from_comparison_ha) ||
        item.excluded_from_comparison_ha < 0 ||
        !Number.isFinite(item.after_water_mask_agreement) ||
        item.after_water_mask_agreement < 0 ||
        item.after_water_mask_agreement > 1
      )
        throw new Error("Invalid comparison sector or pixel domain.");
      for (const kind of ["loss", "gain"]) {
        const m = item[kind];
        if (
          !Number.isFinite(item[`radar_${kind}_ha`]) ||
          Math.abs(
            item[`radar_${kind}_ha`] - unit.detected_change[`${kind}_ha`],
          ) > 0.001 ||
          !m ||
          ![m.tp_px, m.fp_px, m.fn_px, m.tn_px].every(
            (n) => Number.isInteger(n) && n >= 0,
          ) ||
          m.tp_px + m.fp_px + m.fn_px + m.tn_px !== item.common_valid_px
        )
          throw new Error(
            "Comparison counts do not match the observation package.",
          );
        const expected = {
          precision: safeRatio(m.tp_px, m.tp_px + m.fp_px),
          recall: safeRatio(m.tp_px, m.tp_px + m.fn_px),
          f1: safeRatio(2 * m.tp_px, 2 * m.tp_px + m.fp_px + m.fn_px),
          iou: safeRatio(m.tp_px, m.tp_px + m.fp_px + m.fn_px),
        };
        for (const [key, value] of Object.entries(expected)) {
          if (
            value === null
              ? m[key] !== null
              : !Number.isFinite(m[key]) || Math.abs(value - m[key]) > 0.000001
          )
            throw new Error(
              "Comparison metrics do not match their confusion counts.",
            );
        }
      }
    }
  }
  async function load() {
    const failures = [];
    const raw = {};
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
          raw[key] = await response.text();
          return [key, JSON.parse(raw[key])];
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
    if (globalThis.crypto?.subtle) {
      for (const key of ["stats", "analysis"]) {
        const digest = await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(raw[key]),
        );
        const hex = [...new Uint8Array(digest)]
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("");
        if (hex !== data.validation.source[`${key}_sha256`])
          throw new Error(
            "Mixed analysis versions detected. Reload the complete observation package.",
          );
      }
    }
    return {
      data,
      warnings: failures.map(
        (k) => `${files[k]} is unavailable; its optional map layer is hidden.`,
      ),
    };
  }
  return { load, validate };
})();
