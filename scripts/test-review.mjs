/* Meaningful persistence, import and version-isolation checks; no dependencies. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";

const read = (name) =>
  readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const data = {
  analysis: JSON.parse(read("web/data/analysis.json")),
  validation: JSON.parse(read("web/data/validation.json")),
};
const sandbox = { window: {} };
vm.runInNewContext(read("web/js/review-store.js"), sandbox);
const api = sandbox.window.SBReviewStore;
function fixture(options = {}) {
  let text = options.initial || null,
    index = 0;
  const storage = {
    getItem: () => text,
    setItem: (_key, value) => {
      if (options.fail) throw new Error("Quota exceeded");
      text = value;
    },
  };
  const store = api.create({
    data: options.data || data,
    storage,
    now: () => "2026-11-15T12:00:00.000Z",
    uuid: () => `review-${++index}`,
  });
  return { store, raw: () => text };
}
const fields = {
  unit_key: "sector-3",
  reviewer: "Demo reviewer",
  outcome: "needs_data",
  rationale:
    "Optical change overlap is limited. Request independent water-level records.",
  next_action: "water_level",
  evidence_reference: "field-note-001",
};
const log = (records) => JSON.stringify({ schema_version: 1, records });
test("review survives reload, preserves the engine verdict and exports its local identity scope", () => {
  const f = fixture(),
    verdict = data.analysis.sectors[2].conclusion.status;
  const saved = f.store.save(fields);
  assert.equal(saved.observation.loss_ha, 34.3);
  assert.equal(saved.observation.engine_status, verdict);
  assert.equal(data.analysis.sectors[2].conclusion.status, verdict);
  const reloaded = fixture({ initial: f.raw() }).store;
  assert.equal(reloaded.latest("sector-3").outcome, "needs_data");
  const exported = JSON.parse(reloaded.export());
  assert.equal(exported.identity_verified, false);
  assert.equal(exported.storage_scope, "local_browser_demo");
  assert.equal(exported.records[0].source, "self_reported_local_review");
  saved.rationale = "mutated";
  assert.notEqual(reloaded.latest("sector-3").rationale, "mutated");
});
test("a new package retains old history without applying its review to the new measurements", () => {
  const f = fixture();
  f.store.save(fields);
  const updated = JSON.parse(JSON.stringify(data));
  updated.validation.package_id = "f".repeat(64);
  const next = fixture({ initial: f.raw(), data: updated }).store;
  assert.equal(next.all().length, 1);
  assert.equal(next.current("sector-3").length, 0);
  assert.equal(next.latest("sector-3"), null);
});
test("invalid reviews and active URL schemes cannot be saved", () => {
  const f = fixture();
  for (const change of [
    { reviewer: "A" },
    { rationale: "too short" },
    { outcome: "approved_by_nasa" },
    { next_action: "send" },
    { unit_key: "sector-99" },
    { evidence_reference: "javascript:alert(1)" },
  ])
    assert.throws(() => f.store.save({ ...fields, ...change }));
  assert.equal(f.store.all().length, 0);
  assert.equal(f.raw(), null);
});
test("duplicate imports are idempotent, field order is irrelevant and conflicting IDs are atomic", () => {
  const f = fixture();
  f.store.save(fields);
  const records = JSON.parse(f.store.export()).records;
  const reordered = Object.fromEntries(Object.entries(records[0]).reverse());
  reordered.observation = Object.fromEntries(
    Object.entries(reordered.observation).reverse(),
  );
  assert.equal(f.store.import(log([reordered])), 0);
  const before = f.raw(),
    conflict = {
      ...records[0],
      rationale: "A different rationale using an existing record ID.",
    };
  assert.throws(
    () =>
      f.store.import(
        log([{ ...records[0], id: "new-valid-record" }, conflict]),
      ),
    /Conflicting/,
  );
  assert.equal(f.raw(), before);
  assert.equal(f.store.all().length, 1);
});
test("imports reject fabricated snapshots, malformed dates and duplicate IDs before writing", () => {
  const f = fixture();
  f.store.save(fields);
  const record = JSON.parse(f.store.export()).records[0],
    before = f.raw();
  for (const bad of [
    { ...record, observation: { ...record.observation, loss_ha: 999 } },
    { ...record, created_utc: 0 },
    { ...record, source: "authenticated" },
    { ...record, observation: {} },
  ]) {
    assert.throws(() => f.store.import(log([bad])));
    assert.equal(f.raw(), before);
  }
  assert.throws(() => f.store.import(log([record, record])), /Duplicate/);
  assert.throws(() => f.store.import("{invalid"), /JSON/);
  assert.equal(f.raw(), before);
});
test("corrupt storage is never overwritten and quota failures do not mark a review saved", () => {
  assert.throws(() => fixture({ initial: "corrupt" }), /JSON/);
  const f = fixture({ fail: true });
  assert.throws(() => f.store.save(fields), /Quota/);
  assert.equal(f.store.latest("sector-3"), null);
  assert.equal(f.raw(), null);
});

const browser = { window: {} };
vm.runInNewContext(read("web/js/data.js"), browser);
const full = Object.fromEntries(
  Object.entries({
    stats: "stats.json",
    analysis: "analysis.json",
    validation: "validation.json",
    evaluation: "evaluation.json",
    layers: "layers.json",
    meta: "meta.json",
    sectors: "sectors.geojson",
  }).map(([key, file]) => [key, JSON.parse(read(`web/data/${file}`))]),
);
test("frontend rejects corrupted comparison counts, metrics, dates and sector IDs", () => {
  browser.window.SBData.validate(full);
  for (const mutate of [
    (v) => (v.study_area.loss.f1 = 0.99),
    (v) => v.study_area.loss.tp_px++,
    (v) => v.radar_dates.pop(),
    (v) => (v.sectors[1].id = v.sectors[0].id),
    (v) => delete v.study_area.radar_loss_ha,
  ]) {
    const bad = JSON.parse(JSON.stringify(full));
    mutate(bad.validation);
    assert.throws(() => browser.window.SBData.validate(bad));
  }
});

test("reported metrics use fractions and retain their stated source without rewriting sensor counts", () => {
  assert.equal(full.evaluation.f1, 0.88);
  assert.equal(full.evaluation.precision, 0.92);
  assert.equal(full.evaluation.recall, 0.86);
  const archived = JSON.stringify(full.validation);
  browser.window.SBData.validate(full);
  assert.equal(JSON.stringify(full.validation), archived);
  for (const value of [92, -0.1, null]) {
    const bad = JSON.parse(JSON.stringify(full));
    bad.evaluation.precision = value;
    assert.throws(
      () => browser.window.SBData.validate(bad),
      /evaluation summary/,
    );
  }
});

test("whole-area reports distinguish team-reported evaluation from sector sensor comparisons", () => {
  vm.runInNewContext(read("web/js/report.js"), browser);
  const report = browser.window.SBReport.markdown(
    full.analysis.study_area,
    full,
  );
  assert.match(report, /Team-reported project evaluation/);
  assert.match(report, /F1: 0\.88/);
  assert.match(report, /Precision: 92%/);
  assert.match(report, /Recall: 86%/);
  assert.match(report, /F1 0\.135949/);
  const sector = browser.window.SBReport.markdown(
    full.analysis.sectors[0],
    full,
  );
  assert.doesNotMatch(sector, /Team-reported project evaluation/);
});
