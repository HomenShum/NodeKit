import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readYaml } from "../src/lib/files.mjs";
import { checkRepository } from "../src/lib/repo-check.mjs";
import { loadRegistry, validateRegistry } from "../src/lib/registry.mjs";

const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function writeFixture(root, { declaration = false, providerInUi = false } = {}) {
  await mkdir(path.join(root, "src", "components"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "fixture",
      scripts: {
        check: "node --check src/runtime.ts",
        demo: "node src/runtime.ts",
        dev: "node src/runtime.ts",
        doctor: "node --check src/runtime.ts",
        proof: "node src/runtime.ts",
      },
    }),
  );
  await writeFile(
    path.join(root, "nodekit.yaml"),
    `schemaVersion: nodekit.repo/v1
repository: HomenShum/NodeProof
lifecycle: production
support: active
role: certification-harness
commandProfile: application
canonicalFor:
  - proofloop.certification
consumes:
  - nodeplatform.repo-contract
  - nodeagent.agent-run
  - nodeagent.trace-workpaper
commands:
  dev: { script: dev, mode: service }
  demo: { script: demo, mode: finite }
  doctor: { script: doctor, mode: finite }
  check: { script: check, mode: finite }
  proof: { script: proof, mode: finite }
noKey:
  status: certified
  command: npm run demo
  externalAccountsRequired: 0
  disclosure: Deterministic fixture only.
environment:
  contractVersion: nodeplatform.env/v1
  status: not-applicable
proof:
  command: npm run proof
  receiptSchema: proofloop.receipt/v1
contractDeclarations:${declaration ? `
  - concept: nodeagent.agent-run
    signature: agent-run-result
    path: src/runtime.ts
    mode: adapter
    origin: nodeagent.agent-run` : " []"}
architectureExceptions: []
`,
  );
  await writeFile(path.join(root, "src", "runtime.ts"), "export type AgentRunResult = { ok: boolean };\n");
  if (providerInUi) {
    await writeFile(
      path.join(root, "src", "components", "Panel.tsx"),
      'import OpenAI from "openai";\nexport const Panel = OpenAI;\n',
    );
  }
}

test("central registry and platform manifest are internally consistent", async () => {
  const registry = await loadRegistry(platformRoot);
  const manifestSchema = JSON.parse(
    await readFile(path.join(platformRoot, "schemas", "nodekit.schema.json"), "utf8"),
  );
  assert.equal(manifestSchema.$id.includes("nodekit.schema.json"), true);
  assert.deepEqual(validateRegistry(registry), []);
  const result = await checkRepository(platformRoot, registry);
  assert.equal(result.passed, true, result.errors.join("\n"));
});

test("a maintainer checks a nonstandard framework folder while missing downstream repositories stay failures", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-ecosystem-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const framework = path.join(root, "framework checkout");
  const workspace = path.join(root, "separate workspace");
  await mkdir(workspace, { recursive: true });
  const manifest = await readYaml(path.join(platformRoot, "nodekit.yaml"));
  const files = ["ownership.yaml", "repositories.yaml", "architecture.yaml", "nodekit.yaml", "package.json",
    ...manifest.contractDeclarations.map((entry) => entry.path)];
  for (const file of files) {
    await mkdir(path.dirname(path.join(framework, file)), { recursive: true });
    await writeFile(path.join(framework, file), await readFile(path.join(platformRoot, file)));
  }
  const registry = await loadRegistry(framework);
  assert.deepEqual(validateRegistry(registry), []);
  const downstreams = registry.repositoryCatalog.repositories.filter((repo) =>
    repo.commandProfile !== "untracked" && repo.name !== "NodeKit");
  const run = promisify(execFile);
  const inspect = async () => {
    let report;
    await assert.rejects(run(process.execPath, [path.join(platformRoot, "src", "cli.mjs"),
      "ecosystem", "check", "--registry-root", framework, "--workspace", workspace, "--json"],
    { cwd: root, timeout: 30_000, maxBuffer: 1024 * 1024 }), (error) => {
      assert.equal(error.code, 1);
      report = JSON.parse(error.stdout);
      return true;
    });
    assert.equal(report.passed, false);
    assert.equal(report.repositories.length, downstreams.length + 1);
    const self = report.repositories.find((repo) => repo.repository === "HomenShum/NodeKit");
    assert.ok(self, "the framework manifest must actually be read");
    assert.equal(self.passed, true, self.errors.join("\n"));
    return report;
  };
  const burst = await Promise.all(Array.from({ length: 3 }, () => inspect()));
  for (const report of burst) {
    for (const repo of downstreams) {
      const missing = report.repositories.find((entry) => entry.repository === repo.name);
      assert.ok(missing, `${repo.name} must remain in the report`);
      assert.equal(missing.passed, false);
      assert.deepEqual(missing.errors, [`repository checkout is missing at ${path.join(workspace, repo.name)}`]);
    }
  }
  // A similarly named workspace directory cannot replace the actual framework root.
  await mkdir(path.join(workspace, "NodeKit"));
  await writeFile(path.join(workspace, "NodeKit", "nodekit.yaml"), "schemaVersion: invalid\n");
  await writeFixture(path.join(workspace, "NodeProof"), { declaration: true });
  for (let call = 0; call < 4; call += 1) {
    const report = await inspect();
    const proof = report.repositories.find((repo) => repo.repository === "HomenShum/NodeProof");
    assert.equal(proof.passed, true, proof.errors.join("\n"));
    assert.equal(report.repositories.filter((repo) => repo.errors.some((error) =>
      error.includes("repository checkout is missing"))).length, downstreams.length - 1);
  }
  const proofManifest = path.join(workspace, "NodeProof", "nodekit.yaml");
  await writeFile(proofManifest, (await readFile(proofManifest, "utf8")).replace("lifecycle: production", "lifecycle: imaginary"));
  const malformed = (await inspect()).repositories.find((repo) => repo.repository === "HomenShum/NodeProof");
  assert.equal(malformed.passed, false);
  assert.match(malformed.errors.join("\n"), /invalid lifecycle imaginary/);
});

test("an undeclared canonical signature fails closed", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-undeclared-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFixture(root);
  const result = await checkRepository(root, await loadRegistry(platformRoot));
  assert.equal(result.passed, false);
  assert.match(result.errors.join("\n"), /undeclared contract signature agent-run-result/);
});

test("a classified adapter signature is accepted", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-adapter-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFixture(root, { declaration: true });
  const result = await checkRepository(root, await loadRegistry(platformRoot));
  assert.equal(result.passed, true, result.errors.join("\n"));
});

test("generated JSON metadata is not scanned as executable source", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-json-metadata-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFixture(root, { declaration: true });
  await writeFile(
    path.join(root, "src", "components", "generated.json"),
    JSON.stringify({ renderedCode: 'import OpenAI from "openai";' }),
  );
  const result = await checkRepository(root, await loadRegistry(platformRoot));
  assert.equal(result.passed, true, result.errors.join("\n"));
});

test("ignored temporary proof copies are not scanned as repository source", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-temp-copy-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFixture(root, { declaration: true });
  await mkdir(path.join(root, ".tmp", "copied-repo"), { recursive: true });
  await writeFile(
    path.join(root, ".tmp", "copied-repo", "runtime.ts"),
    "export type AgentRunResult = { copied: true };\n",
  );
  const result = await checkRepository(root, await loadRegistry(platformRoot));
  assert.equal(result.passed, true, result.errors.join("\n"));
});

test("nested temporary-looking source directories remain fail-closed", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-nested-temp-source-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFixture(root, { declaration: true });
  await mkdir(path.join(root, "src", ".tmp-runtime"), { recursive: true });
  await writeFile(
    path.join(root, "src", ".tmp-runtime", "runtime.ts"),
    "export type AgentRunResult = { hidden: true };\n",
  );
  const result = await checkRepository(root, await loadRegistry(platformRoot));
  assert.equal(result.passed, false);
  assert.match(result.errors.join("\n"), /undeclared contract signature agent-run-result/);
});

test("provider SDK imports in UI fail architecture conformance", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-ui-provider-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFixture(root, { declaration: true, providerInUi: true });
  const result = await checkRepository(root, await loadRegistry(platformRoot));
  assert.equal(result.passed, false);
  assert.match(result.errors.join("\n"), /architecture rule no-provider-sdk-in-ui/);
});

test("malformed lifecycle and no-key fields cannot pass on source conformance alone", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-malformed-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFixture(root, { declaration: true });
  const manifestPath = path.join(root, "nodekit.yaml");
  const manifest = (await readFile(manifestPath, "utf8"))
    .replace("lifecycle: production", "lifecycle: imaginary")
    .replace("status: certified", "status: maybe");
  await writeFile(manifestPath, manifest);
  const result = await checkRepository(root, await loadRegistry(platformRoot));
  assert.equal(result.passed, false);
  assert.match(result.errors.join("\n"), /invalid lifecycle imaginary/);
  assert.match(result.errors.join("\n"), /invalid noKey.status maybe/);
});

test("registry consumers cannot be omitted from a repository manifest", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-consumer-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFixture(root, { declaration: true });
  const manifestPath = path.join(root, "nodekit.yaml");
  const manifest = (await readFile(manifestPath, "utf8")).replace("  - nodeagent.trace-workpaper\n", "");
  await writeFile(manifestPath, manifest);
  const result = await checkRepository(root, await loadRegistry(platformRoot));
  assert.equal(result.passed, false);
  assert.match(result.errors.join("\n"), /consumes omits registered concept nodeagent.trace-workpaper/);
});

test("stale contract declarations fail closed", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-stale-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFixture(root, { declaration: true });
  await writeFile(path.join(root, "src", "runtime.ts"), "export type Unrelated = { ok: boolean };\n");
  const result = await checkRepository(root, await loadRegistry(platformRoot));
  assert.equal(result.passed, false);
  assert.match(result.errors.join("\n"), /stale contract declaration/);
});

test("certified no-key paths cannot require external accounts", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-no-key-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFixture(root, { declaration: true });
  const manifestPath = path.join(root, "nodekit.yaml");
  const manifest = (await readFile(manifestPath, "utf8")).replace("externalAccountsRequired: 0", "externalAccountsRequired: 1");
  await writeFile(manifestPath, manifest);
  const result = await checkRepository(root, await loadRegistry(platformRoot));
  assert.equal(result.passed, false);
  assert.match(result.errors.join("\n"), /certified no-key status cannot require an external account/);
});

test("no-key commands must resolve to repository scripts", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-command-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await writeFixture(root, { declaration: true });
  const manifestPath = path.join(root, "nodekit.yaml");
  const manifest = (await readFile(manifestPath, "utf8")).replace("command: npm run demo", "command: npm run imaginary");
  await writeFile(manifestPath, manifest);
  const result = await checkRepository(root, await loadRegistry(platformRoot));
  assert.equal(result.passed, false);
  assert.match(result.errors.join("\n"), /noKey.command must reference an existing npm script/);
});
