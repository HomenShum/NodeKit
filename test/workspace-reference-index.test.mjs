import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildWorkspaceReferenceIndex,
  readWorkspaceReferenceIndex,
  verifyWorkspaceReferenceIndex,
} from "../src/lib/workspace-reference-index.mjs";

const hash = (character) => character.repeat(64);
const workspace = {
  schemaVersion: "nodekit.native-workspace/v1",
  workspaceId: `workspace:sha256:${hash("a")}`,
  artifactRef: `native-workspace:sha256:${hash("b")}`,
  artifactDigest: hash("b"),
  ownerRef: "owner:private",
  repository: { canonicalRemote: "private" },
};
const session = {
  schemaVersion: "nodekit.native-agent-session/v1",
  sessionId: `session:sha256:${hash("c")}`,
  workspaceArtifactRef: workspace.artifactRef,
  workspaceArtifactDigest: workspace.artifactDigest,
  artifactRef: `native-agent-session:sha256:${hash("d")}`,
  artifactDigest: hash("d"),
  providerSessionIdHash: hash("e"),
};
const checkpoint = {
  schemaVersion: "nodekit.native-session-checkpoint/v1",
  sessionArtifactRef: session.artifactRef,
  sessionArtifactDigest: session.artifactDigest,
  artifactRef: `native-session-checkpoint:sha256:${hash("f")}`,
  artifactDigest: hash("f"),
  sequence: 3,
  resumeCursorHash: hash("1"),
};

async function temporaryRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "nodekit-reference-index-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test("operator compiles only canonical refs and digests into a disposable index", async (t) => {
  const root = await temporaryRoot(t);
  const state = await buildWorkspaceReferenceIndex(root, {
    builtFromCaseflowDigest: hash("9"),
    builtAt: "2026-07-30T12:00:00.000Z",
    caseflowArtifacts: [checkpoint, session, workspace],
  });
  assert.equal(state.entries.length, 1);
  assert.deepEqual(Object.keys(state.entries[0]).sort(), [
    "latestCheckpointDigest",
    "latestCheckpointRef",
    "sessionArtifactDigest",
    "sessionArtifactRef",
    "sessionId",
    "workspaceArtifactDigest",
    "workspaceArtifactRef",
    "workspaceId",
  ]);
  const serialized = JSON.stringify(state);
  assert.equal(serialized.includes("owner:private"), false);
  assert.equal(serialized.includes("providerSessionIdHash"), false);
  assert.equal(serialized.includes("resumeCursorHash"), false);
  assert.deepEqual(await readWorkspaceReferenceIndex(root), state);
});

test("tampering and authority-bearing cache fields fail closed", async (t) => {
  const root = await temporaryRoot(t);
  const state = await buildWorkspaceReferenceIndex(root, {
    builtFromCaseflowDigest: hash("9"),
    builtAt: "2026-07-30T12:00:00.000Z",
    caseflowArtifacts: [workspace],
  });
  assert.throws(
    () => verifyWorkspaceReferenceIndex({
      ...state,
      entries: [{ ...state.entries[0], status: "resumed" }],
    }),
    /authority-bearing field/,
  );
  const statePath = path.join(
    root,
    ".nodekit",
    "workspace-reference-index",
    "index.json",
  );
  const tampered = JSON.parse(await readFile(statePath, "utf8"));
  tampered.entries[0].workspaceArtifactDigest = hash("8");
  await writeFile(statePath, JSON.stringify(tampered), "utf8");
  await assert.rejects(readWorkspaceReferenceIndex(root), /indexDigest is invalid/);
});

test("burst and sustained rebuilds stay bounded and converge without session authority", async (t) => {
  const root = await temporaryRoot(t);
  const input = {
    builtFromCaseflowDigest: hash("9"),
    builtAt: "2026-07-30T12:00:00.000Z",
    caseflowArtifacts: [workspace, session, checkpoint],
  };
  const burst = await Promise.all(
    Array.from({ length: 50 }, () => buildWorkspaceReferenceIndex(root, input)),
  );
  assert.equal(new Set(burst.map((state) => state.indexDigest)).size, 1);
  for (let index = 0; index < 250; index += 1) {
    await buildWorkspaceReferenceIndex(root, input);
  }
  const final = await readWorkspaceReferenceIndex(root);
  assert.equal(final.entries.length, 1);
  assert.equal("status" in final.entries[0], false);
  assert.equal("resumable" in final.entries[0], false);
});

test("input order and equal-sequence checkpoint races compile to one byte-stable projection", async (t) => {
  const firstRoot = await temporaryRoot(t);
  const secondRoot = await temporaryRoot(t);
  const competingCheckpoint = {
    ...checkpoint,
    artifactRef: `native-session-checkpoint:sha256:${hash("0")}`,
    artifactDigest: hash("0"),
  };
  const base = {
    builtFromCaseflowDigest: hash("9"),
    builtAt: "2026-07-30T12:00:00.000Z",
  };
  const first = await buildWorkspaceReferenceIndex(firstRoot, {
    ...base,
    caseflowArtifacts: [workspace, checkpoint, session, competingCheckpoint],
  });
  const second = await buildWorkspaceReferenceIndex(secondRoot, {
    ...base,
    caseflowArtifacts: [competingCheckpoint, session, checkpoint, workspace],
  });
  assert.deepEqual(second, first);
  assert.equal(
    first.entries[0].latestCheckpointRef,
    checkpoint.artifactRef,
  );
});

test("negative checkpoint sequences fail closed instead of becoming a false latest checkpoint", async (t) => {
  const root = await temporaryRoot(t);
  await assert.rejects(
    buildWorkspaceReferenceIndex(root, {
      builtFromCaseflowDigest: hash("9"),
      builtAt: "2026-07-30T12:00:00.000Z",
      caseflowArtifacts: [workspace, session, { ...checkpoint, sequence: -1 }],
    }),
    /non-negative safe integer/,
  );
});
