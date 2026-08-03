// A renderer was about to be hand-rolled. Redirected to a library, current docs revealed that the
// primitive in training memory had been deprecated — makeAssistantToolUI was gone, the right one was
// makeAssistantDataUI. Introspecting the installed package then turned up a better citation
// primitive than the one planned. And asking whether the advertised framework was needed, or only
// the protocol underneath it, replaced a heavy dependency with about forty lines.
//
// Three separate saves, one habit: find out what is true now, then find out what is true HERE.
// Memory answers neither. Docs answer the first. Only introspection answers the second, because
// docs describe the current release and you are running whatever you installed.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

export const INTEGRATION_DIR = "integrations";
export const DOCS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function fail(message) {
  const error = new Error(message);
  error.code = "INTEGRATION_RECORD_INVALID";
  throw error;
}

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

export function parseIntegrationRecord(raw, label = INTEGRATION_DIR) {
  const doc = parse(raw) ?? {};
  for (const field of ["library", "resolvedVersion", "docsSource", "docsCheckedAt", "introspection"]) {
    if (!isNonEmptyString(doc[field])) fail(`${label}: needs a non-empty ${field}`);
  }
  if (Number.isNaN(Date.parse(doc.docsCheckedAt))) fail(`${label}: docsCheckedAt must be a date`);

  // deprecationsFound must be present even when empty: an absent list and an empty one look
  // identical in YAML, and only one of them means somebody looked.
  if (!Array.isArray(doc.deprecationsFound)) {
    fail(`${label}: needs deprecationsFound as a list; an empty list is the claim that you checked and found none`);
  }

  // The default is to adopt whatever the library advertises. Asking the question is the whole
  // intervention, so the record has to show it was asked.
  const fvp = doc.frameworkVsProtocol;
  if (!fvp || typeof fvp !== "object") fail(`${label}: needs a frameworkVsProtocol answer`);
  for (const field of ["advertisedPath", "adopted", "rationale"]) {
    if (!isNonEmptyString(fvp[field])) fail(`${label}: frameworkVsProtocol needs ${field}`);
  }
  return doc;
}

export async function readIntegrationRecord(repoRoot, library) {
  const file = path.join(repoRoot, INTEGRATION_DIR, `${library}.yaml`);
  return parseIntegrationRecord(await readFile(file, "utf8"), `${INTEGRATION_DIR}/${library}.yaml`);
}

/**
 * `installedVersion` is the load-bearing argument. A record describing 0.15.1 while the project runs
 * 0.16.0 is not a record of this integration — it is a record of the last one, and it reads exactly
 * the same.
 */
export function evaluateIntegrationRecord(record, { installedVersion, now = Date.now() } = {}) {
  const faults = [];
  if (installedVersion && record.resolvedVersion !== installedVersion) {
    faults.push(`records ${record.library}@${record.resolvedVersion} but ${installedVersion} is installed; the introspection describes a version nobody is running`);
  }
  const age = now - Date.parse(record.docsCheckedAt);
  if (age > DOCS_TTL_MS) {
    faults.push(`docs for ${record.library} were checked ${Math.round(age / 86400000)} days ago; a deprecation lands between releases, not on a schedule`);
  }
  return { passed: faults.length === 0, library: record.library, faults };
}
