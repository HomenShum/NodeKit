import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  MOTION_PORTABILITY_RECEIPT_SCHEMA,
  compareMotionPortability,
  normalizeMotionValue,
} from "../src/lib/motion-portability.mjs";
import { validateSchema } from "../src/lib/schema-validation.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function fixture(t, repositories) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-motion-portability-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const paths = {};
  for (const [repositoryId, files] of Object.entries(repositories)) {
    const repositoryRoot = path.join(root, repositoryId);
    paths[repositoryId] = repositoryRoot;
    for (const [relativePath, source] of Object.entries(files)) {
      const file = path.join(repositoryRoot, relativePath);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, source, "utf8");
    }
  }
  return { paths, root };
}

test("motion value normalization removes spelling noise without collapsing distinct semantics", () => {
  assert.equal(normalizeMotionValue(".12s"), "120ms");
  assert.equal(normalizeMotionValue("120.4ms"), "120ms");
  assert.equal(
    normalizeMotionValue("cubic-bezier(.16, 1, .3, 1)"),
    "cubic-bezier(0.16,1,0.3,1)",
  );
  assert.notEqual(
    normalizeMotionValue("cubic-bezier(.16, 1, .3, 1)"),
    normalizeMotionValue("cubic-bezier(.2, .8, .25, 1)"),
  );
});

// @nodekit-verifies studio.motion-portability#detects-silent-cross-repo-drift
test("the receipt catches the real false-friend shape and binds its denominator", async (t) => {
  const { paths } = await fixture(t, {
    nodeslide: {
      "src/styles/tokens.css": `
        :root {
          --duration-faster: 120ms;
          --duration-fast: 180ms;
          --ease-out: cubic-bezier(0.2, 0.8, 0.25, 1);
        }
      `,
    },
    noderoom: {
      "docs/design/tokens.css": `
        :root {
          --duration-fast: .12s;
          --duration-normal: .20s;
          --duration-slow: .40s;
        }
      `,
      "src/ui/mobile.css": `
        :root {
          --duration-fast: 120ms;
          --duration-normal: 220ms;
          --duration-slow: 380ms;
        }
      `,
    },
    parity: {
      "src/styles/tokens.css": `
        :root {
          --duration-faster: .12s;
          --duration-fast: .18s;
          --ease-out: cubic-bezier(.2,.8,.25,1);
        }
      `,
    },
  });

  const receipt = await compareMotionPortability([
    paths.nodeslide,
    paths.noderoom,
    paths.parity,
  ]);
  assert.equal(receipt.schemaVersion, MOTION_PORTABILITY_RECEIPT_SCHEMA);
  assert.equal(receipt.verdict, "FAIL");
  assert.equal(receipt.exitCode, 1);
  assert.equal(receipt.passed, false);
  assert.deepEqual(
    receipt.conflicts.map((conflict) => [conflict.token, conflict.scope]),
    [
      ["--duration-fast", "cross-repository"],
      ["--duration-normal", "within-repository"],
      ["--duration-slow", "within-repository"],
    ],
  );
  assert.equal(receipt.coverage.repositoriesRequested, 3);
  assert.equal(receipt.coverage.readableRepositories, 3);
  assert.equal(receipt.coverage.cssFilesRead, undefined);
  assert.equal(receipt.coverage.declarationsObserved, 12);
  assert.ok(
    receipt.coverage.repositories.every((repository) =>
      /^[a-f0-9]{64}$/.test(repository.sourceSetSha256),
    ),
    "the exact CSS source set must bind the receipt",
  );
  assert.equal(receipt.proof.runtimeObserved, false);
  assert.match(receipt.boundary, /Runtime instrumentation/);
  assert.deepEqual(
    await validateSchema(
      "nodekit.motion-portability-receipt.v1.schema.json",
      receipt,
      "motion portability receipt",
    ),
    [],
  );
});

// @nodekit-verifies studio.motion-portability#normalizes-equivalent-values
test("seconds, milliseconds, and bezier spelling compare as the same behavior", async (t) => {
  const { paths } = await fixture(t, {
    first: {
      "tokens.css": `
        :root {
          --duration-fast: .12s;
          --ease-out-expo: cubic-bezier(.16,1,.3,1);
        }
      `,
    },
    second: {
      "tokens.css": `
        :root {
          --duration-fast: 120ms;
          --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
        }
      `,
    },
  });
  const receipt = await compareMotionPortability([paths.first, paths.second]);
  assert.equal(receipt.verdict, "PASS");
  assert.deepEqual(receipt.conflicts, []);
  assert.equal(receipt.migration.summary.behaviorPreservingAliases, 4);
});

// @nodekit-verifies studio.motion-portability#incomplete-coverage-is-not-run
test("an absent repository is NOT_RUN rather than a vacuous pass", async (t) => {
  const { paths, root } = await fixture(t, {
    readable: {
      "tokens.css": ":root { --duration-fast: 120ms; }",
    },
  });
  const receipt = await compareMotionPortability([
    paths.readable,
    path.join(root, "does-not-exist"),
  ]);
  assert.equal(receipt.verdict, "NOT_RUN");
  assert.equal(receipt.exitCode, 3);
  assert.equal(receipt.passed, false);
  assert.equal(receipt.coverage.comparisonPossible, false);
  assert.equal(receipt.coverage.unreadableRepositories.length, 1);
});

// @nodekit-verifies studio.motion-portability#aliases-preserve-behavior
test("migration aliases preserve exact values and changed values remain review-only", async (t) => {
  const { paths } = await fixture(t, {
    productA: {
      "tokens.css": `
        :root {
          --duration-fast: 180ms;
          --duration-faster: 120ms;
          --motion-legacy: var(--duration-fast);
          /* --duration-fast: 999ms; a comment is not a live claim */
        }
      `,
    },
    productB: {
      "tokens.css": `
        :root {
          --duration-fast: 180ms;
          --duration-faster: 120ms;
          --motion-fast: 120ms;
          --duration-normal: 220ms;
        }
      `,
    },
  });
  const receipt = await compareMotionPortability([paths.productA, paths.productB]);
  assert.equal(receipt.verdict, "PASS");
  assert.equal(
    receipt.coverage.repositories.find((entry) => entry.repositoryId === "productA")
      .aliasDeclarationsIgnoredAsIndependentClaims,
    1,
    "a var() alias is recorded in the denominator but is not an independent value claim",
  );
  const fast = receipt.migration.readyAliases.find(
    (alias) => alias.repositoryId === "productA" && alias.token === "--duration-fast",
  );
  assert.equal(fast.canonicalToken, "--motion-base");
  assert.equal(fast.observedValue, "180ms");
  const review = receipt.migration.reviewRequired.find(
    (entry) => entry.repositoryId === "productB" && entry.token === "--duration-normal",
  );
  assert.deepEqual(
    { deltaMs: review.deltaMs, from: review.from, to: review.to },
    { deltaMs: 20, from: "220ms", to: "240ms" },
  );
  assert.doesNotMatch(
    receipt.migration.repositories.find((entry) => entry.repositoryId === "productB").aliasCss,
    /--duration-normal:/,
    "a value-changing proposal must never be emitted as a ready alias",
  );
  const sameValueDifferentNames = receipt.valueAliases.find((entry) => entry.value === "120ms");
  assert.deepEqual(sameValueDifferentNames.tokens, ["--duration-faster", "--motion-fast"]);
});

test("two empty directories cannot manufacture a green comparison", async (t) => {
  const { paths } = await fixture(t, {
    first: { "readme.css": "body { color: black; }" },
    second: { "readme.css": "body { color: white; }" },
  });
  const receipt = await compareMotionPortability([paths.first, paths.second]);
  assert.equal(receipt.verdict, "NOT_RUN");
  assert.equal(receipt.coverage.comparisonPossible, false);
  assert.equal(receipt.coverage.declarationsObserved, 0);
});

test("the CLI writes the same schema-bound receipt it prints", async (t) => {
  const { paths, root } = await fixture(t, {
    first: { "tokens.css": ":root { --duration-fast: 180ms; }" },
    second: { "tokens.css": ":root { --duration-fast: 120ms; }" },
  });
  const output = path.join(root, "receipt.json");
  const result = spawnSync(
    process.execPath,
    [
      path.join(REPO, "src", "cli.mjs"),
      "motion",
      "compare",
      paths.first,
      paths.second,
      "--output",
      output,
      "--json",
    ],
    { cwd: REPO, encoding: "utf8", shell: false },
  );
  assert.equal(result.status, 1, result.stderr);
  const printed = JSON.parse(result.stdout);
  const written = JSON.parse(await readFile(output, "utf8"));
  assert.deepEqual(written, printed);
  assert.equal(written.verdict, "FAIL");
});

test("the command exposes usable help without scanning or writing", () => {
  const result = spawnSync(
    process.execPath,
    [path.join(REPO, "src", "cli.mjs"), "motion", "compare", "--help"],
    { cwd: REPO, encoding: "utf8", shell: false },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /never applies a migration/);
});
