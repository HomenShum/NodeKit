import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

import { contentHash } from "../src/lib/caseflow.mjs";

const execFileAsync = promisify(execFile);
const hash = (value) => contentHash({ value });

function fixture() {
  const repository = {
    canonicalRemote: "https://github.com/example/repo.git",
    commit: "a".repeat(40),
    treeHash: "b".repeat(40),
    dirty: false,
  };
  const receipt = (kind) => ({
    ref: `receipt:${kind}`,
    digest: hash(kind),
    verified: true,
  });
  return {
    migratedAt: "2026-07-30T12:00:00.000Z",
    records: [{
      recordId: "legacy:cli",
      ownerRef: "owner:one",
      authenticatedOwnerRef: "owner:one",
      caseId: "case:one",
      repository,
      writeMode: "read-only",
      workspaceAuthorityReceipt: receipt("workspace"),
      providerSessionIdHash: hash("provider"),
      sessionCreationReceipt: receipt("session"),
      adapter: {
        adapterId: "codex",
        adapterVersion: "adapter:1",
        harnessVersion: "harness:1",
      },
      writeScope: "read-only",
      checkpoint: {
        resumeCursorHash: hash("cursor"),
        repository,
        traceDigest: hash("trace"),
        artifactDigests: [],
        receipt: receipt("checkpoint"),
        operationNonceHash: hash("nonce"),
      },
      nativeSessionId: "raw-provider-id",
      status: "resumed",
    }],
  };
}

test("operator applies, verifies, then retires legacy input into a recoverable rollback", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "nodekit-native-migration-"));
  const input = path.join(directory, "legacy.json");
  const output = path.join(directory, "bundle.json");
  const rollback = path.join(directory, "rollback", "legacy.json");
  try {
    await writeFile(input, JSON.stringify(fixture()), "utf8");
    const apply = await execFileAsync(
      process.execPath,
      [
        "src/cli.mjs",
        "session",
        "migrate-legacy",
        "--mode",
        "apply",
        "--input",
        input,
        "--output",
        output,
        "--json",
      ],
      { cwd: path.resolve(".") },
    );
    const applied = JSON.parse(apply.stdout);
    assert.equal(applied.passed, true);
    const verify = await execFileAsync(
      process.execPath,
      [
        "src/cli.mjs",
        "session",
        "migrate-legacy",
        "--mode",
        "verify",
        "--output",
        output,
        "--json",
      ],
      { cwd: path.resolve(".") },
    );
    assert.equal(JSON.parse(verify.stdout).passed, true);
    const retire = await execFileAsync(
      process.execPath,
      [
        "src/cli.mjs",
        "session",
        "migrate-legacy",
        "--mode",
        "retire",
        "--input",
        input,
        "--output",
        output,
        "--rollback",
        rollback,
        "--confirm-bundle-digest",
        applied.bundleDigest,
        "--json",
      ],
      { cwd: path.resolve(".") },
    );
    const retired = JSON.parse(retire.stdout);
    assert.equal(retired.passed, true);
    await assert.rejects(readFile(input, "utf8"), { code: "ENOENT" });
    assert.equal(JSON.parse(await readFile(rollback, "utf8")).records.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
