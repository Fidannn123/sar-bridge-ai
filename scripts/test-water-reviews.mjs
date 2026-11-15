import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const read = (path) =>
  readFileSync(new URL(`../web/${path}`, import.meta.url), "utf8");
const sandbox = { window: {} };
vm.runInNewContext(read("js/water-review-store.js"), sandbox);
const api = sandbox.window.SBWaterReviews;
const shamkir = JSON.parse(read("data/water-studies/shamkir/analysis.json"));
const enguri = JSON.parse(read("data/water-studies/enguri/analysis.json"));
const fields = {
  reviewer: "Reviewer A",
  outcome: "needs_data",
  rationale: "Check gauge readings and an independent shoreline reference.",
};
function fixture() {
  const saved = new Map();
  const storage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  };
  const options = { storage, now: () => "2026-11-15T12:30:00.000Z" };
  return { saved, storage, options, store: api.create(options) };
}
test("optical reviews survive reload, use existing keys and append history", () => {
  const f = fixture();
  const first = f.store.save(shamkir, 6, fields);
  assert.equal(
    api.keyFor(shamkir, 6),
    `sar-bridge:optical-review:shamkir:${shamkir.package_id}:6`,
  );
  assert.equal(first.source, "local_self_reported");
  const reloaded = api.create(f.options);
  reloaded.save(shamkir, 6, {
    ...fields,
    reviewer: "Reviewer B",
    outcome: "reviewed",
  });
  const records = reloaded.read(shamkir, 6);
  assert.equal(records.length, 2);
  assert.equal(records[0].reviewer, "Reviewer A");
  assert.equal(records[1].reviewer, "Reviewer B");
  assert.match(api.markdown(records), /Assessment: More evidence needed/);
  assert.match(api.markdown(records), /Reviewer: Reviewer B/);
});
test("reviews remain isolated by water body, sector and export package", () => {
  const f = fixture();
  f.store.save(shamkir, 6, fields);
  assert.equal(f.store.read(shamkir, null).length, 0);
  assert.equal(f.store.read(shamkir, 3).length, 0);
  assert.equal(f.store.read(enguri, 6).length, 0);
  assert.equal(
    f.store.read({ ...shamkir, package_id: "f".repeat(64) }, 6).length,
    0,
  );
  assert.throws(() => f.store.save(shamkir, 99, fields), /Unknown/);
});
test("invalid records, corrupt data and mixed versions are never overwritten", () => {
  const f = fixture(),
    key = api.keyFor(shamkir, 6);
  for (const raw of [
    "invalid",
    "{}",
    JSON.stringify([{ ...fields, created_utc: "invalid" }]),
  ]) {
    f.saved.set(key, raw);
    assert.throws(() => f.store.save(shamkir, 6, fields));
    assert.equal(f.saved.get(key), raw);
  }
  f.saved.clear();
  const record = f.store.save(shamkir, 6, fields);
  const otherKey = api.keyFor(enguri, 6);
  f.saved.set(otherKey, JSON.stringify([record]));
  assert.throws(() => f.store.save(enguri, 6, fields), /another area/);
  assert.equal(JSON.parse(f.saved.get(otherKey))[0].study_id, "shamkir");
});
test("blank rationale, unknown assessments and failed storage writes cannot report a saved review", () => {
  const f = fixture();
  for (const value of [
    { ...fields, reviewer: " " },
    { ...fields, rationale: " ".repeat(30) },
    { ...fields, outcome: "approved" },
  ])
    assert.throws(() => f.store.save(shamkir, 6, value));
  assert.equal(f.saved.size, 0);
  const blocked = api.create({
    storage: {
      ...f.storage,
      setItem() {
        throw new Error("Storage quota reached");
      },
    },
  });
  assert.throws(() => blocked.save(shamkir, 6, fields), /quota/);
  assert.equal(f.store.read(shamkir, 6).length, 0);
});
