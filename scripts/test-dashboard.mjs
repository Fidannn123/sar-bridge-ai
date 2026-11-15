import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const data = {
  analysis: JSON.parse(read("web/data/analysis.json")),
  validation: JSON.parse(read("web/data/validation.json")),
};
const sandbox = { window: {} };
vm.runInNewContext(read("web/js/review-store.js"), sandbox);
vm.runInNewContext(read("web/js/dashboard.js"), sandbox);
const { SBReviewStore: reviews, SBDashboard: dashboard } = sandbox.window;
function fixture(nextData = data, initial = null) {
  let stored = initial,
    index = 0;
  const store = reviews.create({
    data: nextData,
    storage: {
      getItem: () => stored,
      setItem: (_key, value) => (stored = value),
    },
    now: () => "2026-11-15T12:00:00.000Z",
    uuid: () => `dashboard-review-${++index}`,
  });
  return {
    store,
    raw: () => stored,
    summary: () =>
      dashboard.summarize(nextData, (unit) => ({
        storage_available: true,
        records: store.current(reviews.keyFor(unit)),
      })),
  };
}
const fields = {
  unit_key: "sector-3",
  reviewer: "Demo reviewer",
  outcome: "reviewed",
  rationale: "The radar measurement requires independent field observations.",
  evidence_reference: "note-03",
  next_action: "water_level",
};
test("overview uses actual sectors, significant-change threshold and independent engine counts", () => {
  const f = fixture(),
    s = f.summary();
  assert.equal(s.total, 10);
  assert.equal(s.changed, 4);
  assert.equal(s.recorded, 0);
  assert.equal(s.human.pending, 10);
  assert.equal(s.engine.supported, 1);
  assert.equal(s.engine.plausible, 1);
  assert.equal(s.engine.insufficient, 2);
  assert.equal(s.engine.no_change, 6);
  assert.equal(s.rows[0].unit.id, 2);
  assert.equal(s.rows[0].unit.detected_change.loss_ha, 279.6);
  assert.equal(s.rows.at(-1).unit.id, 7);
  assert.equal(
    data.analysis.sectors[0].id,
    1,
    "sorting must not reorder the analysis package",
  );
});
test("review coverage counts a sector once and uses its latest outcome without changing engine status", () => {
  const f = fixture();
  f.store.save(fields);
  f.store.save({ ...fields, outcome: "needs_data" });
  const s = f.summary();
  assert.equal(s.recorded, 1);
  assert.equal(s.human.pending, 9);
  assert.equal(s.human.needs_data, 1);
  assert.equal(s.human.reviewed, 0);
  assert.equal(s.engine.supported, 1);
  assert.equal(s.rows.find((row) => row.unit.id === 3).human, "needs_data");
});
test("a whole-reservoir record does not inflate sector review coverage", () => {
  const f = fixture();
  f.store.save({ ...fields, unit_key: "reservoir" });
  assert.equal(f.summary().recorded, 0);
  assert.equal(f.summary().human.pending, 10);
});
test("earlier-package reviews are retained but excluded from overview coverage", () => {
  const f = fixture();
  f.store.save(fields);
  const updated = JSON.parse(JSON.stringify(data));
  updated.validation.package_id = "c".repeat(64);
  const next = fixture(updated, f.raw());
  assert.equal(next.store.all().length, 1);
  assert.equal(next.summary().recorded, 0);
  assert.equal(next.summary().human.pending, 10);
});
test("unavailable storage is unknown coverage, never a claim of ten pending reviews", () => {
  const s = dashboard.summarize(data, () => ({
    storage_available: false,
    records: [],
  }));
  assert.equal(s.storage_available, false);
  assert.equal(s.human.unavailable, 10);
  assert.equal(s.human.pending, 0);
});
