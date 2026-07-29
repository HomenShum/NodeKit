#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveNpmCliInvocation } from "../src/lib/npm-cli-invocation.mjs";
import { inspectNpmPackageArchiveBytes } from "../src/lib/npm-package-archive.mjs";

const COMMIT = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
    const name = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`);
    options[name] = value;
    index += 1;
  }
  return options;
}

async function jsonFile(value, label) {
  if (!value) throw new Error(`--${label} is required`);
  return JSON.parse(await readFile(path.resolve(value), "utf8"));
}

async function boundJsonFile(value, label) {
  if (!value) throw new Error(`--${label} is required`);
  const bytes = await readFile(path.resolve(value));
  return {
    value: JSON.parse(bytes.toString("utf8")),
    reference: { path: value.replaceAll("\\", "/"), sha256: createHash("sha256").update(bytes).digest("hex") },
  };
}

function required(options, name) {
  const value = options[name];
  if (typeof value !== "string" || value.length === 0) throw new Error(`--${name} is required`);
  return value;
}

function installedRelativePath(installRoot, installedPath, label) {
  const relative = path.relative(installRoot, installedPath);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escaped the disposable candidate installation: ${installedPath}`);
  }
  return relative.replaceAll("\\", "/");
}

function releaseCandidateFromOptions(options, tarballSha256) {
  const releaseCandidate = {
    nodekitCommit: required(options, "nodekit-commit"),
    nodekitSourceHash: required(options, "nodekit-source-hash"),
    nodekitTarballSha256: required(options, "nodekit-tarball-sha256"),
    packageName: required(options, "package-name"),
    packageVersion: required(options, "package-version"),
  };
  if (!COMMIT.test(releaseCandidate.nodekitCommit)) throw new Error("--nodekit-commit must be a lowercase 40-character Git commit");
  if (!SHA256.test(releaseCandidate.nodekitSourceHash)) throw new Error("--nodekit-source-hash must be a lowercase SHA-256 digest");
  if (!SHA256.test(releaseCandidate.nodekitTarballSha256)) throw new Error("--nodekit-tarball-sha256 must be a lowercase SHA-256 digest");
  if (releaseCandidate.nodekitTarballSha256 !== tarballSha256) throw new Error("candidate tarball SHA-256 does not match --nodekit-tarball-sha256");
  if (releaseCandidate.packageName !== "@homenshum/nodekit") throw new Error("--package-name must be @homenshum/nodekit");
  return releaseCandidate;
}

async function installedPackageFileManifest(packageRoot) {
  const files = [];
  async function visit(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`installed candidate contains a symbolic link: ${relative}`);
      if (entry.isDirectory()) {
        // Dependency installations are not package payload bytes. npm may place
        // them here depending on its hoisting decision, so keep them outside the
        // comparison with the package archive's complete regular-file manifest.
        if (relative === "node_modules") continue;
        await visit(absolute, relative);
        continue;
      }
      if (!entry.isFile()) throw new Error(`installed candidate contains an unsupported filesystem entry: ${relative}`);
      const bytes = await readFile(absolute);
      files.push({ path: relative, sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length });
    }
  }
  await visit(packageRoot);
  return files;
}

async function bindExecutionReceipts(measurements) {
  const bound = structuredClone(measurements);
  for (const [profile, cases] of Object.entries(bound)) {
    for (const [caseId, metric] of Object.entries(cases ?? {})) {
      if (typeof metric.executionReceiptPath !== "string") throw new Error(`${profile}/${caseId} executionReceiptPath is required`);
      const bytes = await readFile(path.resolve(metric.executionReceiptPath));
      const actual = createHash("sha256").update(bytes).digest("hex");
      if (actual !== metric.executionReceiptSha256) throw new Error(`${profile}/${caseId} execution receipt file hash mismatch`);
      metric.execution = JSON.parse(bytes.toString("utf8"));
    }
  }
  return bound;
}

const options = parseArgs(process.argv.slice(2));
const candidateTarballInput = path.resolve(required(options, "candidate-tarball"));
const candidateTarballMetadata = await lstat(candidateTarballInput, { bigint: true });
if (!candidateTarballMetadata.isFile() || candidateTarballMetadata.isSymbolicLink()) {
  throw new Error("--candidate-tarball must be a regular non-symlink file");
}
const candidateTarball = await realpath(candidateTarballInput);
const candidateTarballBytes = await readFile(candidateTarball);
const tarballSha256 = createHash("sha256").update(candidateTarballBytes).digest("hex");
const releaseCandidate = releaseCandidateFromOptions(options, tarballSha256);
const inspectedArchive = inspectNpmPackageArchiveBytes(candidateTarballBytes, {
  expectedName: releaseCandidate.packageName,
  expectedVersion: releaseCandidate.packageVersion,
  expectedTarballSha256: releaseCandidate.nodekitTarballSha256,
});
const installRoot = await mkdtemp(path.join(os.tmpdir(), "nodekit-knowledge-comparison-candidate-"));

try {
  await writeFile(path.join(installRoot, "package.json"), `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`, "utf8");
  const snapshottedCandidateTarball = path.join(installRoot, "candidate.tgz");
  await writeFile(snapshottedCandidateTarball, candidateTarballBytes, { flag: "wx" });
  const snapshotMetadata = await lstat(snapshottedCandidateTarball, { bigint: true });
  if (!snapshotMetadata.isFile() || snapshotMetadata.isSymbolicLink()) throw new Error("snapshotted candidate tarball is not a regular non-symlink file");
  const snapshottedCandidateBytes = await readFile(snapshottedCandidateTarball);
  if (!snapshottedCandidateBytes.equals(candidateTarballBytes)
    || createHash("sha256").update(snapshottedCandidateBytes).digest("hex") !== releaseCandidate.nodekitTarballSha256) {
    throw new Error("install-local candidate snapshot does not match the already-inspected tarball bytes");
  }
  const npmInvocation = resolveNpmCliInvocation([
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
    snapshottedCandidateTarball,
  ]);
  execFileSync(npmInvocation.command, npmInvocation.args, {
    cwd: installRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CI: "1",
      NO_COLOR: "1",
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_ignore_scripts: "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });

  const consumerRequire = createRequire(path.join(installRoot, "package.json"));
  const runtimeEntrypoint = await realpath(consumerRequire.resolve("@homenshum/nodekit/knowledge-runtime"));
  const installedPackageJson = await realpath(consumerRequire.resolve("@homenshum/nodekit/package.json"));
  const runtimeEntrypointPath = installedRelativePath(installRoot, runtimeEntrypoint, "knowledge runtime entrypoint");
  const packageJsonPath = installedRelativePath(installRoot, installedPackageJson, "installed package.json");
  const installedPackageBytes = await readFile(installedPackageJson);
  const runtimeEntrypointBytes = await readFile(runtimeEntrypoint);
  const installedPackage = JSON.parse(installedPackageBytes.toString("utf8"));
  if (installedPackage.name !== releaseCandidate.packageName || installedPackage.version !== releaseCandidate.packageVersion) {
    throw new Error("installed packed candidate identity does not match the exact release candidate");
  }
  const installedManifest = await installedPackageFileManifest(path.dirname(installedPackageJson));
  if (JSON.stringify(installedManifest) !== JSON.stringify(inspectedArchive.fileManifest)) {
    // Name the delta. An integrity error that only says "differs" forces the next reader to
    // rebuild the comparison by hand to learn anything; the check already holds both sides, so
    // withholding them makes the sensor weaker than the evidence it collected.
    const byPath = (list) => new Map(list.map((entry) => [entry.path, entry]));
    const installed = byPath(installedManifest);
    const archived = byPath(inspectedArchive.fileManifest);
    const onlyInstalled = [...installed.keys()].filter((p) => !archived.has(p));
    const onlyArchived = [...archived.keys()].filter((p) => !installed.has(p));
    const changed = [...installed.keys()].filter((p) => {
      const other = archived.get(p);
      return other && (other.sha256 !== installed.get(p).sha256 || other.size !== installed.get(p).size);
    });
    const sample = (label, list) => (list.length ? `${label}: ${list.slice(0, 5).join(", ")}${list.length > 5 ? ` (+${list.length - 5} more)` : ""}` : null);
    // Name the CAUSE, not the symptom — and note that the first attempt at this comment named the
    // WRONG cause with confidence, which is worse than naming none.
    //
    // The real mechanism, root-caused 2026-07-28 by byte-level comparison: npm's `bin-links`
    // rewrites the FIRST shebang of a DECLARED BIN from CRLF to LF at install time
    // (`fix-bin.js`, predicate `/^#![^\n]+\r\n/`). `--ignore-scripts` does NOT disable bin linking.
    // So a bin whose working copy carries a CRLF shebang is packed with `\r\n` and installed with
    // `\n` — a one-byte difference, at offset 19, in exactly one file out of 463.
    //
    // Why it hid: `.gitattributes` is `* text=auto eol=lf`, so the INDEX blob is pure LF while the
    // physical working file was CRLF. `git status` reports the file clean, because normalization
    // makes its logical content equal. Only `git ls-files --eol` shows `i/lf w/mixed`.
    //
    // The earlier hypothesis — "the working tree is dirty, and packing runs `prepare`, so two packs
    // can differ" — was wrong twice over. The payload is pinned (one byte array is read, inspected,
    // written, byte-compared and hash-verified before install; there is no second archive source),
    // and the unrelated dirty file was irrelevant. "Clean checkout passes" was a proxy for "a fresh
    // checkout materialised LF", not evidence about dirtiness at all. A confounded correlation,
    // stated as a mechanism, sent three agents and an external model hunting the wrong thing.
    const CRLF_SHEBANG = /^#![^\n]+\r\n/;
    let binNote = null;
    try {
      const declaredBins = Object.values(inspectedArchive.packageJson?.bin ?? {})
        .map((value) => `package/${String(value).replace(/^\.?\//, "")}`);
      const offenders = (inspectedArchive.entries ?? [])
        .filter((entry) => declaredBins.includes(entry.path) && CRLF_SHEBANG.test(entry.contents?.toString("utf8") ?? ""))
        .map((entry) => entry.path);
      if (offenders.length) {
        binNote =
          `DECLARED BIN WITH A CRLF SHEBANG (${offenders.join(", ")}). npm's bin-links rewrites the ` +
          `first shebang of a declared bin from CRLF to LF on install, so the archived and installed ` +
          `bytes differ by exactly one byte and this check fails through no fault of the package. ` +
          `Fix the SOURCE file's line endings — do not relax the comparison. Note git may report the ` +
          `file clean: check \`git ls-files --eol\` for \`w/mixed\`.`;
      }
    } catch {
      // The archive shape may not expose entries in every version. Fall through with the raw
      // comparison, which is still the honest evidence. Never let a diagnostic's own failure
      // suppress the finding it was added to explain.
    }
    const detail = [
      binNote,
      `installed=${installedManifest.length} archived=${inspectedArchive.fileManifest.length}`,
      sample("only in install", onlyInstalled),
      sample("only in archive", onlyArchived),
      sample("content differs", changed),
    ].filter(Boolean).join("; ");
    throw new Error(`installed candidate file manifest differs from the inspected tarball payload — ${detail}`);
  }
  const postInstallSnapshotBytes = await readFile(snapshottedCandidateTarball);
  if (!postInstallSnapshotBytes.equals(candidateTarballBytes)
    || createHash("sha256").update(postInstallSnapshotBytes).digest("hex") !== releaseCandidate.nodekitTarballSha256) {
    throw new Error("install-local candidate snapshot changed during installation");
  }

  const candidateRuntime = await import(pathToFileURL(runtimeEntrypoint).href);
  for (const exportName of ["runProtectedKnowledgeComparison", "retrieveAcceptedKnowledge", "createKnowledgeComparisonExecutionReceipt"]) {
    if (typeof candidateRuntime[exportName] !== "function") throw new Error(`installed packed candidate is missing ${exportName}`);
  }

  const definitionPath = required(options, "definition");
  const definitionBytes = await readFile(path.resolve(definitionPath));
  const definition = JSON.parse(definitionBytes.toString("utf8"));
  const [flatGraph, staticGraph, evolvingGraph] = await Promise.all([
    boundJsonFile(options.flat, "flat"),
    boundJsonFile(options.static, "static"),
    boundJsonFile(options.evolving, "evolving"),
  ]);
  const result = candidateRuntime.runProtectedKnowledgeComparison({
    definition,
    definitionEvidencePath: definitionPath,
    definitionEvidenceSha256: createHash("sha256").update(definitionBytes).digest("hex"),
    expectedDefinitionSha256: required(options, "definition-sha256"),
    graphs: {
      flat: flatGraph.value,
      staticGraph: staticGraph.value,
      evolvingGraph: evolvingGraph.value,
    },
    graphEvidence: { flat: flatGraph.reference, staticGraph: staticGraph.reference, evolvingGraph: evolvingGraph.reference },
    measurements: await bindExecutionReceipts(await jsonFile(options.measurements, "measurements")),
    releaseCandidate,
    completedAt: options["completed-at"] ?? new Date().toISOString(),
  });
  if (JSON.stringify(result.releaseCandidate) !== JSON.stringify(releaseCandidate)) {
    throw new Error("protected comparison result did not retain the exact installed release candidate identity");
  }
  const output = path.resolve(options.out ?? "proof/evolution/protected-runtime-comparison.json");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    output,
    status: result.status,
    adoptionClaim: result.adoptionClaim,
    resultSha256: result.resultSha256,
    releaseCandidate,
    installedRuntime: {
      isolated: true,
      lifecycleScriptsDisabled: true,
      sourceCheckoutImported: false,
      packageJsonPath,
      packageJsonSha256: createHash("sha256").update(installedPackageBytes).digest("hex"),
      runtimeEntrypointPath,
      runtimeEntrypointSha256: createHash("sha256").update(runtimeEntrypointBytes).digest("hex"),
    },
  }, null, 2));
} finally {
  await rm(installRoot, { recursive: true, force: true });
}
