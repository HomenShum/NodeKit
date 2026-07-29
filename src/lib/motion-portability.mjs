import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export const MOTION_PORTABILITY_RECEIPT_SCHEMA = "nodekit.motion-portability-receipt/v1";
export const MOTION_SEMANTICS_SCHEMA = "nodekit.motion-semantics/v1";

const MOTION_TOKEN_NAME =
  /^--(?:motion|duration|dur|ease|transition|spring|rd-dur|rd-ease)[a-z0-9-]*$/i;
const CUSTOM_PROPERTY = /(--[a-z0-9-]+)\s*:\s*([^;}]+)[;}]/gi;
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", ".git"]);

function frozenSemantic(token, value, meaning, kind) {
  return Object.freeze({
    kind,
    meaning,
    normalizedValue: normalizeMotionValue(value),
    token,
    value,
  });
}

/**
 * One semantic scale, independent of the CSS, Framer Motion, GSAP, or Three.js
 * adapter that executes it. Generated applications receive this vocabulary;
 * NodeKit core only owns the contract and comparison.
 */
export const DEFAULT_MOTION_SEMANTICS = Object.freeze({
  schemaVersion: MOTION_SEMANTICS_SCHEMA,
  durations: Object.freeze([
    frozenSemantic("--motion-instant", "80ms", "state flip with no perceived travel", "duration"),
    frozenSemantic("--motion-quick", "120ms", "micro-feedback such as hover or focus", "duration"),
    frozenSemantic("--motion-base", "180ms", "standard enter or exit", "duration"),
    frozenSemantic("--motion-considered", "240ms", "modal, panel, or route transition", "duration"),
    frozenSemantic("--motion-deliberate", "380ms", "large surface or deliberate reveal", "duration"),
  ]),
  easings: Object.freeze([
    frozenSemantic(
      "--motion-ease-standard",
      "cubic-bezier(0.2,0.8,0.25,1)",
      "standard interface transition",
      "easing",
    ),
    frozenSemantic(
      "--motion-ease-expressive",
      "cubic-bezier(0.16,1,0.3,1)",
      "expressive deceleration",
      "easing",
    ),
    frozenSemantic(
      "--motion-ease-spring",
      "cubic-bezier(0.32,0.72,0,1)",
      "spring-like arrival without a runtime spring dependency",
      "easing",
    ),
  ]),
  reviewHints: Object.freeze({
    "--duration-normal": "--motion-considered",
    "--duration-slow": "--motion-deliberate",
    "--motion-slow": "--motion-deliberate",
  }),
});

/**
 * Normalize representation, not meaning. `.12s` equals `120ms`, and decimal
 * spelling inside the same cubic-bezier does not create a false conflict.
 */
export function normalizeMotionValue(raw) {
  let value = String(raw).trim().toLowerCase().replace(/\s+/g, "");
  const seconds = value.match(/^(-?\d*\.?\d+)s$/);
  if (seconds) return `${Math.round(Number.parseFloat(seconds[1]) * 1000)}ms`;
  const milliseconds = value.match(/^(-?\d*\.?\d+)ms$/);
  if (milliseconds) return `${Math.round(Number.parseFloat(milliseconds[1]))}ms`;
  const bezier = value.match(/^cubic-bezier\(([^)]+)\)$/);
  if (bezier) {
    const numbers = bezier[1].split(",").map((part) => Number.parseFloat(part));
    if (numbers.length === 4 && numbers.every(Number.isFinite)) {
      value = `cubic-bezier(${numbers.map(String).join(",")})`;
    }
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedSite(repositoryId, root, file) {
  return `${repositoryId}:${path.relative(root, file).replaceAll("\\", "/")}`;
}

async function walkCss(root, directory = root, errors = []) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    errors.push({
      path: path.relative(root, directory).replaceAll("\\", "/") || ".",
      reason: error.message,
    });
    return [];
  }

  const found = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIPPED_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await walkCss(root, absolute, errors)));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".css")) found.push(absolute);
  }
  return found;
}

function repositoryInputs(repositories) {
  const seen = new Map();
  return repositories.map((input) => {
    const supplied = typeof input === "string" ? { root: input } : input;
    const root = path.resolve(supplied.root);
    const baseId = supplied.id || path.basename(root);
    const count = (seen.get(baseId) ?? 0) + 1;
    seen.set(baseId, count);
    return {
      id: count === 1 ? baseId : `${baseId}#${count}`,
      root,
    };
  });
}

function semanticEntries(contract) {
  return [...contract.durations, ...contract.easings];
}

function durationDelta(from, to) {
  const fromMatch = from.match(/^(-?\d+)ms$/);
  const toMatch = to.match(/^(-?\d+)ms$/);
  if (!fromMatch || !toMatch) return null;
  return Number(toMatch[1]) - Number(fromMatch[1]);
}

function cssAliasBlock(contract, aliases) {
  const lines = [":root {"];
  for (const semantic of semanticEntries(contract)) {
    lines.push(`  ${semantic.token}: ${semantic.value};`);
  }
  if (aliases.length) lines.push("");
  for (const alias of aliases) {
    lines.push(
      `  ${alias.token}: var(${alias.canonicalToken}); /* ${alias.observedValue} preserved */`,
    );
  }
  lines.push("}");
  return lines.join("\n");
}

function migrationPlan(scans, contract) {
  const semantics = semanticEntries(contract);
  const byValue = new Map();
  for (const semantic of semantics) {
    const current = byValue.get(semantic.normalizedValue) ?? [];
    current.push(semantic);
    byValue.set(semantic.normalizedValue, current);
  }
  const byToken = new Map(semantics.map((semantic) => [semantic.token, semantic]));

  const repositories = [];
  const readyAliases = [];
  const reviewRequired = [];
  const ownerDecisions = [];
  const unmapped = [];
  const alreadyCanonical = [];

  for (const scan of scans) {
    const grouped = new Map();
    for (const declaration of scan.declarations) {
      const current = grouped.get(declaration.token) ?? [];
      current.push(declaration);
      grouped.set(declaration.token, current);
    }

    const repositoryAliases = [];
    for (const [token, declarations] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
      const values = [...new Set(declarations.map((entry) => entry.normalizedValue))].sort();
      const sites = [...new Set(declarations.map((entry) => entry.site))].sort();
      if (values.length > 1) {
        ownerDecisions.push({
          repositoryId: scan.repositoryId,
          token,
          values,
          sites,
          reason:
            "The same repository declares multiple values. Choose the authoritative behavior before generating an alias.",
        });
        continue;
      }

      const observedValue = values[0];
      const exact = byValue.get(observedValue) ?? [];
      const canonicalSelf = byToken.get(token);
      if (canonicalSelf && canonicalSelf.normalizedValue === observedValue) {
        alreadyCanonical.push({
          canonicalToken: token,
          observedValue,
          repositoryId: scan.repositoryId,
          sites,
        });
        continue;
      }

      if (exact.length === 1) {
        const target = exact[0];
        const alias = {
          canonicalToken: target.token,
          meaning: target.meaning,
          observedValue,
          repositoryId: scan.repositoryId,
          sites,
          token,
        };
        readyAliases.push(alias);
        repositoryAliases.push(alias);
        continue;
      }

      const hintedToken = contract.reviewHints[token];
      const hinted = hintedToken ? byToken.get(hintedToken) : null;
      if (hinted) {
        reviewRequired.push({
          canonicalToken: hinted.token,
          deltaMs: durationDelta(observedValue, hinted.normalizedValue),
          from: observedValue,
          meaning: hinted.meaning,
          repositoryId: scan.repositoryId,
          sites,
          to: hinted.normalizedValue,
          token,
        });
        continue;
      }

      unmapped.push({
        observedValue,
        repositoryId: scan.repositoryId,
        sites,
        token,
      });
    }

    repositories.push({
      aliasCss: cssAliasBlock(contract, repositoryAliases),
      readyAliasCount: repositoryAliases.length,
      repositoryId: scan.repositoryId,
    });
  }

  return {
    contract: {
      durations: contract.durations,
      easings: contract.easings,
      schemaVersion: contract.schemaVersion,
    },
    repositories,
    readyAliases,
    reviewRequired,
    ownerDecisions,
    unmapped,
    alreadyCanonical,
    summary: {
      alreadyCanonical: alreadyCanonical.length,
      behaviorPreservingAliases: readyAliases.length,
      ownerDecisions: ownerDecisions.length,
      reviewRequiredValueChanges: reviewRequired.length,
      unmappedTokens: unmapped.length,
    },
  };
}

/**
 * Compare static CSS motion declarations across repositories and emit a
 * deterministic, source-set-bound receipt. Runtime execution is deliberately
 * outside this receipt.
 *
 * @param {Array<string | {id?: string, root: string}>} repositories
 * @param {{contract?: typeof DEFAULT_MOTION_SEMANTICS}} [options]
 */
// @nodekit-behavior studio.motion-portability owner
export async function compareMotionPortability(
  repositories,
  { contract = DEFAULT_MOTION_SEMANTICS } = {},
) {
  const requested = repositoryInputs(repositories);
  const scans = [];
  const unreadableRepositories = [];
  const unreadableFiles = [];

  for (const repository of requested) {
    let metadata;
    try {
      metadata = await stat(repository.root);
    } catch (error) {
      unreadableRepositories.push({
        repositoryId: repository.id,
        reason: error.message,
      });
      continue;
    }
    if (!metadata.isDirectory()) {
      unreadableRepositories.push({
        repositoryId: repository.id,
        reason: "path is not a directory",
      });
      continue;
    }

    const walkErrors = [];
    const files = await walkCss(repository.root, repository.root, walkErrors);
    unreadableFiles.push(
      ...walkErrors.map((error) => ({ repositoryId: repository.id, ...error })),
    );
    const declarations = [];
    const fileBindings = [];
    let aliasDeclarations = 0;

    for (const file of files) {
      let source;
      try {
        source = await readFile(file, "utf8");
      } catch (error) {
        unreadableFiles.push({
          path: path.relative(repository.root, file).replaceAll("\\", "/"),
          reason: error.message,
          repositoryId: repository.id,
        });
        continue;
      }
      const relativePath = path.relative(repository.root, file).replaceAll("\\", "/");
      const fileSha256 = sha256(source);
      fileBindings.push({ file: relativePath, sha256: fileSha256 });
      const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "");
      for (const match of withoutComments.matchAll(CUSTOM_PROPERTY)) {
        const token = match[1];
        const rawValue = match[2].trim();
        if (!MOTION_TOKEN_NAME.test(token)) continue;
        if (/var\(/i.test(rawValue)) {
          aliasDeclarations += 1;
          continue;
        }
        declarations.push({
          normalizedValue: normalizeMotionValue(rawValue),
          rawValue,
          site: normalizedSite(repository.id, repository.root, file),
          token,
        });
      }
    }

    const sourceSetSha256 = sha256(
      fileBindings
        .sort((a, b) => a.file.localeCompare(b.file))
        .map((binding) => `${binding.file}\0${binding.sha256}`)
        .join("\n"),
    );
    scans.push({
      aliasDeclarations,
      cssFilesRead: fileBindings.length,
      declarations,
      repositoryId: repository.id,
      sourceSetSha256,
    });
  }

  const table = new Map();
  for (const scan of scans) {
    for (const declaration of scan.declarations) {
      if (!table.has(declaration.token)) table.set(declaration.token, new Map());
      const byValue = table.get(declaration.token);
      if (!byValue.has(declaration.normalizedValue)) {
        byValue.set(declaration.normalizedValue, []);
      }
      byValue.get(declaration.normalizedValue).push({
        repositoryId: scan.repositoryId,
        site: declaration.site,
      });
    }
  }

  const conflicts = [];
  for (const [token, byValue] of [...table].sort(([a], [b]) => a.localeCompare(b))) {
    if (byValue.size < 2) continue;
    const repositoryIds = new Set(
      [...byValue.values()].flat().map((location) => location.repositoryId),
    );
    conflicts.push({
      scope: repositoryIds.size === 1 ? "within-repository" : "cross-repository",
      token,
      values: [...byValue]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([value, locations]) => ({
          repositoryIds: [...new Set(locations.map((location) => location.repositoryId))].sort(),
          sites: [...new Set(locations.map((location) => location.site))].sort(),
          value,
        })),
    });
  }

  const valueTable = new Map();
  for (const [token, byValue] of table) {
    for (const value of byValue.keys()) {
      if (!valueTable.has(value)) valueTable.set(value, new Set());
      valueTable.get(value).add(token);
    }
  }
  const valueAliases = [...valueTable]
    .filter(([, tokens]) => tokens.size > 1)
    .map(([value, tokens]) => ({ tokens: [...tokens].sort(), value }))
    .sort((a, b) => a.value.localeCompare(b.value));

  // Two readable directories are not yet a comparison. Each requested side
  // must contribute at least one live declaration, or "nothing versus nothing"
  // becomes a vacuous PASS.
  const comparisonPossible =
    scans.length >= 2 && scans.every((scan) => scan.declarations.length > 0);
  const coverageComplete =
    comparisonPossible &&
    unreadableRepositories.length === 0 &&
    unreadableFiles.length === 0;
  const verdict = !comparisonPossible
    ? "NOT_RUN"
    : conflicts.length > 0
      ? "FAIL"
      : coverageComplete
        ? "PASS"
        : "NOT_RUN";
  const exitCode = verdict === "PASS" ? 0 : verdict === "FAIL" ? 1 : 3;
  const declarationsObserved = scans.reduce(
    (total, scan) => total + scan.declarations.length,
    0,
  );

  return {
    schemaVersion: MOTION_PORTABILITY_RECEIPT_SCHEMA,
    comparison: "css-motion-tokens",
    verdict,
    passed: verdict === "PASS",
    exitCode,
    coverage: {
      comparisonPossible,
      coverageComplete,
      declarationsObserved,
      distinctTokenNames: table.size,
      readableRepositories: scans.length,
      repositories: scans.map((scan) => ({
        aliasDeclarationsIgnoredAsIndependentClaims: scan.aliasDeclarations,
        cssFilesRead: scan.cssFilesRead,
        declarationsObserved: scan.declarations.length,
        repositoryId: scan.repositoryId,
        sourceSetSha256: scan.sourceSetSha256,
      })),
      repositoriesRequested: requested.length,
      unreadableFiles,
      unreadableRepositories,
    },
    conflicts,
    valueAliases,
    migration: migrationPlan(scans, contract),
    proof: {
      staticDeclarationsObserved: comparisonPossible,
      runtimeObserved: false,
      domOrTraceObserved: false,
      videoReviewed: false,
      audienceValidated: false,
      decisiveFor: [
        "whether one static motion token name resolves to different normalized values",
        "whether a proposed alias preserves the observed static value",
      ],
      notDecisiveFor: [
        "whether an animation executed",
        "computed timing, order, interruption, or final state",
        "reduced-motion behavior at runtime",
        "perceptual quality or audience usefulness",
      ],
    },
    boundary:
      "This receipt compares static CSS declarations. Runtime instrumentation, DOM/trace evidence, perceptual review, and audience validation remain separate receipts and are never blended into this verdict.",
  };
}
