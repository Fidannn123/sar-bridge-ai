import { readFileSync, existsSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import vm from "node:vm";

export const expectedWaterStudies = [
  "shamkir",
  "araz",
  "sevan",
  "enguri",
  "mead",
  "powell",
  "nasser",
  "ataturk",
];

export function validateWaterStudies(web) {
  const file = (name) => {
    const target = resolve(web, name),
      rel = relative(web, target);
    if (isAbsolute(rel) || rel.startsWith("..") || !existsSync(target))
      throw new Error(`Missing or invalid study asset: ${name}`);
    return target;
  };
  const read = (name) => JSON.parse(readFileSync(file(name), "utf8"));
  const index = read("data/water-studies/index.json");
  if (
    index.schema_version !== 1 ||
    !Array.isArray(index.studies) ||
    index.studies.length !== expectedWaterStudies.length ||
    new Set(index.studies.map((s) => s.id)).size !==
      expectedWaterStudies.length ||
    expectedWaterStudies.some((id) => !index.studies.some((s) => s.id === id))
  )
    throw new Error(
      "The eight optical water studies are incomplete or duplicated.",
    );
  const sandbox = { window: {} };
  vm.runInNewContext(readFileSync(file("js/water-study.js"), "utf8"), sandbox, {
    timeout: 1000,
  });
  for (const entry of index.studies) {
    if (entry.analysis_url !== `data/water-studies/${entry.id}/analysis.json`)
      throw new Error("Unexpected study manifest path.");
    const study = read(entry.analysis_url);
    sandbox.window.SBWaterStudy.validate(study, entry.id, entry.package_id);
    if (study.totals.valid_fraction < 0.65)
      throw new Error(`Insufficient common-valid coverage: ${entry.id}`);
    for (const [key, asset] of Object.entries(study.assets)) {
      const hash = createHash("sha256")
        .update(readFileSync(file(asset)))
        .digest("hex");
      if (hash !== study.asset_sha256?.[key])
        throw new Error(
          `Study imagery does not match the manifest: ${entry.id}/${key}`,
        );
    }
  }
  return index.studies.length;
}
