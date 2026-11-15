/* Dependency-free deploy gate. Reuses the browser's data contract. */
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { createHash } from "node:crypto";

const web = resolve(
  process.argv[2] || fileURLToPath(new URL("../web/", import.meta.url)),
);
function localFile(path) {
  const target = resolve(web, path);
  const rel = relative(web, target);
  if (
    rel === ".." ||
    rel.startsWith(`..${sep}`) ||
    isAbsolute(rel) ||
    !existsSync(target) ||
    !statSync(target).isFile()
  ) {
    throw new Error(`Missing or invalid published file: ${path}`);
  }
  return target;
}
function read(path) {
  return readFileSync(localFile(path), "utf8");
}
function json(path) {
  return JSON.parse(read(`data/${path}`));
}

try {
  const html = read("index.html");
  const refs = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
  for (const ref of refs) {
    if (/^(?:[a-z]+:|\/\/|#)/i.test(ref)) continue;
    const path = ref.split(/[?#]/)[0];
    localFile(path);
    if (path.endsWith(".js")) new vm.Script(read(path), { filename: path });
  }
  const data = {
    layers: json("layers.json"),
    stats: json("stats.json"),
    analysis: json("analysis.json"),
    meta: json("meta.json"),
    sectors: json("sectors.geojson"),
    polys: json("change_polygons.geojson"),
    osm: json("reservoir_osm.geojson"),
    validation: json("validation.json"),
    evaluation: json("evaluation.json"),
  };
  const sandbox = { window: {} };
  vm.runInNewContext(read("js/data.js"), sandbox, {
    filename: "js/data.js",
    timeout: 1000,
  });
  sandbox.window.SBData.validate(data);
  for (const key of ["stats", "analysis"]) {
    const hash = createHash("sha256")
      .update(readFileSync(localFile(`data/${key}.json`)))
      .digest("hex");
    if (hash !== data.validation.source[`${key}_sha256`])
      throw new Error(
        "Validation and analysis are from different export versions.",
      );
  }
  for (const [key, layer] of Object.entries(data.layers)) {
    localFile(layer.url);
    if (
      layer.bounds?.length !== 2 ||
      !layer.bounds.every(
        (point) => point.length === 2 && point.every(Number.isFinite),
      )
    ) {
      throw new Error(`Invalid imagery bounds: ${key}`);
    }
  }
  console.log(
    `Static deploy ready: ${data.stats.n_sectors} sectors, ${Object.keys(data.layers).length} image layers; all entry-point assets and JavaScript syntax checked.`,
  );
} catch (error) {
  console.error(`Static deploy rejected: ${error.message}`);
  process.exitCode = 1;
}
