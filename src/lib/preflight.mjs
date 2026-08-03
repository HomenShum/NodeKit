// A plugin was installed mid-session, its own suite passed 82/82, and it was inert for the next six
// hours because registering it needs a restart. Nothing was broken: the install worked, the
// verification worked, and the thing still did nothing, because a setup step with an activation
// dependency was executed at a point where it could not take effect.
//
// Separately, an external generator consumed a brief, ran for two and a half minutes, completed
// five of six tasks, and died out of credit — discovered by opening the page.
//
// These are the same failure. A dependency was declared load-bearing and was not actually able to
// serve the work, and in both cases the gap was found long after the decision to rely on it. So
// preflight runs BEFORE the work, and a blocking dependency that cannot take effect stops it.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

export const PREFLIGHT_FILE = "harness.yaml";
export const ACTIVATION_REQUIREMENTS = Object.freeze(["none", "restart", "interactive-trust", "reinstall"]);
export const DEPENDENCY_KINDS = Object.freeze(["plugin", "external-service"]);

/** How long a liveness observation stays believable. Credit runs out; a week-old probe is a memory. */
export const LIVENESS_TTL_MS = 24 * 60 * 60 * 1000;

function fail(message) {
  const error = new Error(message);
  error.code = "PREFLIGHT_MANIFEST_INVALID";
  throw error;
}

const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

export async function readHarnessManifest(repoRoot = ".") {
  let raw;
  try {
    raw = await readFile(path.join(repoRoot, PREFLIGHT_FILE), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { dependencies: [], present: false };
    throw error;
  }
  const parsed = parse(raw) ?? {};
  const dependencies = parsed.harness ?? [];
  if (!Array.isArray(dependencies)) fail(`${PREFLIGHT_FILE}: "harness" must be a list`);

  for (const [index, dep] of dependencies.entries()) {
    const at = `${PREFLIGHT_FILE}: harness[${index}]`;
    if (!dep || typeof dep !== "object" || Array.isArray(dep)) fail(`${at} must be a mapping`);
    if (!isNonEmptyString(dep.id)) fail(`${at} needs an id`);
    if (!DEPENDENCY_KINDS.includes(dep.kind)) fail(`${at} kind must be one of ${DEPENDENCY_KINDS.join(", ")}`);
    if (!ACTIVATION_REQUIREMENTS.includes(dep.activation?.requires)) {
      fail(`${at} needs activation.requires, one of ${ACTIVATION_REQUIREMENTS.join(", ")}`);
    }
    if (typeof dep.activation.blocking !== "boolean") fail(`${at} needs activation.blocking as a boolean`);
    // Anything that mutates agent behaviour gets verified before it is trusted, not after.
    if (dep.kind === "plugin" && !isNonEmptyString(dep.verifyBefore)) {
      fail(`${at} is a plugin and must declare verifyBefore; trusting something that changes agent behaviour without running its own checks is how an inert install looks healthy`);
    }
    if (dep.kind === "external-service" && !isNonEmptyString(dep.livenessProbe)) {
      fail(`${at} is an external service and must declare a livenessProbe`);
    }
  }
  return { dependencies, present: true };
}

/**
 * `installedAt` and `sessionStartedAt` are what make the restart rule mechanical: an activation
 * requirement is satisfied only if the session began AFTER the install. Installing during the
 * session is precisely the case that reads as done and is not.
 */
export function evaluatePreflight({ dependencies }, { sessionStartedAt, now = Date.now() } = {}) {
  const blockers = [];
  const warnings = [];
  const sessionStart = sessionStartedAt ? Date.parse(sessionStartedAt) : null;

  for (const dep of dependencies) {
    const { id, activation } = dep;

    if (activation.requires !== "none") {
      const installedAt = dep.installedAt ? Date.parse(dep.installedAt) : null;
      // Precedence matters, and getting it wrong is how this gate first passed a dependency nobody
      // had seen work. An explicit `confirmedActive: false` is an OBSERVATION — someone looked and
      // it was not confirmed — so a timestamp may not overturn it. The timestamp only shows the
      // install predates the session, which is necessary for a restart to have taken effect and
      // nowhere near sufficient. It is therefore the fallback for when nobody looked at all.
      const active = dep.activation.confirmedActive === true
        ? true
        : dep.activation.confirmedActive === false
          ? false
          : (activation.requires === "restart" && sessionStart !== null && installedAt !== null && installedAt < sessionStart);
      if (!active) {
        const detail = `${id} needs ${activation.requires} to take effect and has not been confirmed active`
          + (activation.requires === "restart" && installedAt !== null && sessionStart !== null
            ? "; it was installed after this session began, so it is inert right now"
            : "");
        (activation.blocking ? blockers : warnings).push(detail);
      }
    }

    if (dep.kind === "external-service") {
      const checkedAt = dep.livenessCheckedAt ? Date.parse(dep.livenessCheckedAt) : null;
      if (checkedAt === null || Number.isNaN(checkedAt)) {
        blockers.push(`${id} is load-bearing and external, and was never probed for liveness`);
      } else if (now - checkedAt > LIVENESS_TTL_MS) {
        blockers.push(`${id} liveness was last observed ${Math.round((now - checkedAt) / 3600000)}h ago; credit and quota do not persist`);
      }
    }
  }

  return { passed: blockers.length === 0, blockers, warnings, checked: dependencies.length };
}

export function formatPreflight(verdict) {
  if (verdict.checked === 0) return "PREFLIGHT: no harness dependencies declared.";
  const lines = [`PREFLIGHT ${verdict.passed ? "PASS" : "BLOCKED"}: ${verdict.checked} dependency(ies) checked.`];
  for (const blocker of verdict.blockers) lines.push(`  BLOCKED  ${blocker}`);
  for (const warning of verdict.warnings) lines.push(`  warn     ${warning}`);
  if (!verdict.passed) lines.push("", "Resolve these before starting work; discovering them at hour six is the failure this prevents.");
  return lines.join("\n");
}
