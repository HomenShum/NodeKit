import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const validators = new Map();

// Ajv costs 254ms to load and 14 modules import this file, so every `nodekit` invocation paid for
// it — including `--help`, `tour` and `doctor`, which never validate anything. Measured: 708ms for
// `nodekit --help` against 137ms for a bare node boot.
//
// createRequire rather than a dynamic import, because createSchemaAjv is exported and called
// synchronously from four places (`createSchemaAjv().compile(schema)`). Making it async to save
// startup would have changed a public signature to fix an internal cost.
const load = createRequire(import.meta.url);
let Ajv2020;
let addFormats;

export function createSchemaAjv(options = {}) {
  // Interop: ajv is CJS with an ESM-style default, so both shapes are handled rather than assumed.
  if (!Ajv2020) { const m = load("ajv/dist/2020.js"); Ajv2020 = m.default ?? m; }
  if (!addFormats) { const m = load("ajv-formats"); addFormats = m.default ?? m; }
  const ajv = new Ajv2020({ allErrors: true, strict: false, ...options });
  addFormats(ajv);
  return ajv;
}

async function validatorFor(name) {
  if (!validators.has(name)) {
    const schema = JSON.parse(await readFile(path.join(packageRoot, "schemas", name), "utf8"));
    const ajv = createSchemaAjv();
    validators.set(name, ajv.compile(schema));
  }
  return validators.get(name);
}

export async function validateSchema(name, value, label) {
  const validator = await validatorFor(name);
  if (validator(value)) return [];
  return (validator.errors ?? []).map(
    (entry) => `${label}${entry.instancePath || "/"} ${entry.message}`,
  );
}
