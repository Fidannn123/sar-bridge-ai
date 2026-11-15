import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import {
  validateWaterStudies,
  expectedWaterStudies,
} from "./validate-water-studies.mjs";
const web = fileURLToPath(new URL("../web/", import.meta.url));
const read = (path) =>
  readFileSync(new URL(`../web/${path}`, import.meta.url), "utf8");
const sandbox = { window: {} };
vm.runInNewContext(read("js/water-study.js"), sandbox);
const api = sandbox.window.SBWaterStudy;
const studies = expectedWaterStudies.map((id) =>
  JSON.parse(read(`data/water-studies/${id}/analysis.json`)),
);

test("all eight investigations have independent manifests, source scenes and matching imagery", () => {
  assert.equal(validateWaterStudies(web), 8);
  assert.equal(new Set(studies.map((s) => s.package_id)).size, 8);
  for (const s of studies) {
    assert.equal(s.sensor, "Sentinel-2 L2A");
    assert(s.observations.before.scenes.length > 0);
    assert(s.observations.after.scenes.length > 0);
    assert.equal(s.sectors.length, 10);
    assert(
      !("f1" in s),
      "A new study must not inherit an unrelated performance score",
    );
  }
});

test("mismatched location, stale package, invalid dates and inconsistent water totals are rejected", () => {
  const s = studies[0];
  assert.throws(() => api.validate(s, "mead"));
  assert.throws(() => api.validate(s, s.id, "0".repeat(64)));
  for (const mutate of [
    (d) => (d.totals.water_after_ha += 100),
    (d) => (d.sectors[0].loss_ha += 100),
    (d) => (d.totals.valid_fraction = 1.1),
    (d) => (d.observations.after.start_date = d.observations.before.start_date),
    (d) => (d.assets.after = "data/img/s2_after.webp"),
    (d) => (d.sector_geojson.features[0].properties.id = 99),
    (d) =>
      (d.sector_geojson.features[1].properties.id =
        d.sector_geojson.features[0].properties.id),
    (d) => {
      d.totals.water_before_ha += d.totals.valid_area_ha;
      d.totals.water_after_ha += d.totals.valid_area_ha;
      for (const sector of d.sectors) {
        sector.water_before_ha += sector.valid_area_ha;
        sector.water_after_ha += sector.valid_area_ha;
      }
    },
    (d) => (d.totals.valid_fraction = 0.5),
  ]) {
    const bad = JSON.parse(JSON.stringify(s));
    mutate(bad);
    assert.throws(() => api.validate(bad, s.id));
  }
});

test("whole-area and sector exports retain the selected location, dates, sensor and provenance", () => {
  for (const s of studies) {
    const report = api.markdown(s);
    assert(report.includes(s.name));
    assert(report.includes(`Water loss: ${s.totals.loss_ha}`));
    assert(report.includes(s.observations.before.scenes[0].id));
    assert(report.includes(s.package_id));
    assert(!report.includes("F1: 0.88"));
    const sector = api.markdown(s, 6);
    assert(sector.includes("Area: Sector 06"));
    assert(
      sector.includes(
        `Water loss: ${s.sectors.find((x) => x.id === 6).loss_ha}`,
      ),
    );
  }
});
