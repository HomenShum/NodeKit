import assert from "node:assert/strict";
import test from "node:test";

import { contentHash, createMemoryCaseflow } from "../src/lib/caseflow.mjs";
import {
  NativeAgentSessionError,
  session_checkpoint,
  session_resume,
  session_start,
  session_status,
  workspace_bind,
} from "../src/lib/native-agent-identity.mjs";

const hash = (value) => contentHash({ value });
const repository = Object.freeze({
  canonicalRemote: "https://github.com/example/native-session.git",
  commit: "a".repeat(40),
  treeHash: "b".repeat(40),
  dirty: true,
  dirtyWorkingTreeHash: hash("dirty-tree"),
});

function nonceHash(operationNonce) {
  return contentHash({
    schemaVersion: "nodekit.native-operation-nonce/v1",
    nonce: operationNonce,
  });
}

function receipt(kind, operationNonce) {
  const operationNonceHash = nonceHash(operationNonce);
  return {
    ref: `receipt:${kind}:${operationNonceHash.slice(0, 16)}`,
    digest: hash(`${kind}:${operationNonceHash}`),
    operationNonceHash,
    verified: true,
  };
}

function checkpointOutput(kind, operationNonce, sequence, overrides = {}) {
  return {
    resumeCursorHash: hash(`cursor:${sequence}`),
    repository,
    traceDigest: hash(`trace:${sequence}`),
    artifactDigests: [hash(`artifact:${sequence}`)],
    receipt: receipt(kind, operationNonce),
    ...overrides,
  };
}

function createLeaseStore() {
  const held = new Map();
  return {
    async acquire({ keys, owner }) {
      if (keys.some((key) => held.has(key))) return { acquired: false };
      for (const key of keys) held.set(key, owner);
      return { acquired: true, keys, owner };
    },
    async release(lease) {
      for (const key of lease.keys ?? []) {
        if (held.get(key) === lease.owner) held.delete(key);
      }
    },
    isBusy(key) {
      return held.has(key);
    },
    clear() {
      held.clear();
    },
  };
}

function createHarness(options = {}) {
  let tick = 0;
  const clock = () =>
    new Date(Date.UTC(2026, 6, 30, 10, 0, tick++)).toISOString();
  const caseflow = createMemoryCaseflow({
    ownerId: options.ownerId ?? "owner:authenticated",
    clock,
  });
  const createdCase = caseflow.createCase({
    title: "Resume a diligence workspace",
    primaryJob: "Continue the exact coding-agent session",
    actor: { type: "user", id: "owner:authenticated" },
  });
  caseflow.startRun({
    caseId: createdCase.caseId,
    stages: [
      { id: "build", label: "Build", owner: "agent" },
      { id: "verify", label: "Verify", owner: "reviewer" },
    ],
    actor: { type: "system", id: "nodekit" },
  });
  const traceEvents = [];
  const leases = createLeaseStore();
  const providerSessionIdHash = hash(
    options.providerIdentity ?? "provider-session-1",
  );
  const adapter = {
    async start({ operationNonce }) {
      const output = {
        providerSessionIdHash,
        adapterVersion: "claude-code-adapter:1.0.0",
        harnessVersion: "nodekit-harness:1.0.0",
        creationReceipt: receipt("session-created", operationNonce),
        initialCheckpoint: checkpointOutput(
          "initial-checkpoint",
          operationNonce,
          0,
        ),
        runHandle: "run-handle:start",
      };
      return options.startOutput
        ? options.startOutput(output, operationNonce)
        : output;
    },
    async checkpoint({ previousCheckpoint, operationNonce }) {
      const sequence = previousCheckpoint.sequence + 1;
      return checkpointOutput("checkpoint", operationNonce, sequence, {
        paused: options.pauseOnCheckpoint ?? false,
      });
    },
    async resume({ checkpoint, operationNonce }) {
      if (options.resumeDelayMs) {
        await new Promise((resolve) =>
          setTimeout(resolve, options.resumeDelayMs));
      }
      const output = {
        providerSessionIdHash,
        resumeCursorHash: checkpoint.resumeCursorHash,
        resumeReceipt: receipt("session-resumed", operationNonce),
        newCheckpoint: checkpointOutput(
          "resumed-checkpoint",
          operationNonce,
          checkpoint.sequence + 1,
        ),
        runHandle: `run-handle:resume:${checkpoint.sequence + 1}`,
      };
      return options.resumeOutput
        ? options.resumeOutput(output, operationNonce)
        : output;
    },
  };
  const context = {
    caseflow,
    clock,
    timeoutMs: options.timeoutMs ?? 1_000,
    repository: {
      async measure({ operationNonce }) {
        return {
          repository: options.repositoryAtBind ?? repository,
          receipt: receipt("repository-bind", operationNonce),
        };
      },
      async measureCurrent({ operationNonce }) {
        return {
          repository: options.repositoryAtResume ?? repository,
          receipt: receipt("repository-resume", operationNonce),
        };
      },
    },
    adapters: {
      get(adapterId) {
        return adapterId === "claude-code" ? adapter : undefined;
      },
    },
    leases,
    trace: {
      async record(event) {
        traceEvents.push(event);
      },
      list(sessionId) {
        return traceEvents.filter((event) => event.sessionId === sessionId);
      },
    },
  };
  return { caseflow, caseId: createdCase.caseId, context, leases, traceEvents };
}

async function startWorkspaceAndSession(harness, writeScope = "isolated-worktree") {
  const workspace = await workspace_bind(harness.context, {
    caseId: harness.caseId,
    canonicalRemote: repository.canonicalRemote,
    writeMode: writeScope,
  });
  const session = await session_start(harness.context, {
    workspaceId: workspace.workspaceId,
    adapterId: "claude-code",
    writeScope,
  });
  const checkpoint = harness.caseflow
    .snapshot()
    .artifacts
    .flatMap((artifact) => artifact.versions.map((version) => version.content))
    .find(
      (content) =>
        content.schemaVersion === "nodekit.native-session-checkpoint/v1",
    );
  return { workspace, session, checkpoint };
}

// @nodekit-verifies inv:native-agent-session-identity#canonical-idempotency
test("repeated workspace binding and provider session start deduplicate canonical artifacts", async () => {
  const harness = createHarness();
  const first = await startWorkspaceAndSession(harness);
  const secondWorkspace = await workspace_bind(harness.context, {
    caseId: harness.caseId,
    canonicalRemote: repository.canonicalRemote,
    writeMode: "isolated-worktree",
  });
  const secondSession = await session_start(harness.context, {
    workspaceId: secondWorkspace.workspaceId,
    adapterId: "claude-code",
    writeScope: "isolated-worktree",
  });

  assert.equal(first.workspace.disposition, "created");
  assert.equal(first.session.disposition, "created");
  assert.equal(secondWorkspace.disposition, "deduplicated");
  assert.equal(secondSession.disposition, "deduplicated");
  assert.equal(secondWorkspace.workspaceArtifactRef, first.workspace.workspaceArtifactRef);
  assert.equal(secondSession.sessionArtifactRef, first.session.sessionArtifactRef);
  assert.equal(
    harness.caseflow.listCanonicalArtifactContents({ limit: 100 })
      .filter((content) => content.schemaVersion?.startsWith("nodekit.native"))
      .length,
    3,
  );
});

// @nodekit-verifies inv:native-agent-session-identity#validate-before-persist
test("invalid initial repository evidence leaves no partial session artifact", async () => {
  const harness = createHarness({
    startOutput(output) {
      return {
        ...output,
        initialCheckpoint: {
          ...output.initialCheckpoint,
          repository: { ...repository, treeHash: "c".repeat(40) },
        },
      };
    },
  });
  const workspace = await workspace_bind(harness.context, {
    caseId: harness.caseId,
    canonicalRemote: repository.canonicalRemote,
    writeMode: "read-only",
  });

  await assert.rejects(
    session_start(harness.context, {
      workspaceId: workspace.workspaceId,
      adapterId: "claude-code",
      writeScope: "read-only",
    }),
    (error) =>
      error instanceof NativeAgentSessionError
      && error.code === "REPOSITORY_MISMATCH",
  );
  const contents = harness.caseflow.listCanonicalArtifactContents({ limit: 100 });
  assert.equal(
    contents.some((content) => content.schemaVersion === "nodekit.native-agent-session/v1"),
    false,
  );
  assert.equal(
    contents.some((content) => content.schemaVersion === "nodekit.native-session-checkpoint/v1"),
    false,
  );
});

// @nodekit-verifies inv:native-agent-session-identity#three-artifact-canonical-model
test("founder resumes the exact session only after a trusted receipt and a new durable checkpoint", async () => {
  const harness = createHarness();
  const { session, checkpoint } = await startWorkspaceAndSession(harness);

  const before = await session_status(harness.context, {
    sessionId: session.sessionId,
  });
  assert.equal(before.derivedState, "CHECKPOINTED");

  const resumed = await session_resume(harness.context, {
    sessionId: session.sessionId,
    expectedCheckpointDigest: checkpoint.artifactDigest,
  });
  assert.equal(resumed.state, "RESUMED");
  assert.match(resumed.newCheckpointRef, /^native-session-checkpoint:sha256:/);

  const contents = harness.caseflow.listCanonicalArtifactContents({
    limit: 2_000,
  });
  assert.deepEqual(
    contents
      .filter((content) => content.schemaVersion?.startsWith("nodekit.native"))
      .map((content) => content.schemaVersion),
    [
      "nodekit.native-workspace/v1",
      "nodekit.native-agent-session/v1",
      "nodekit.native-session-checkpoint/v1",
      "nodekit.native-session-checkpoint/v1",
    ],
  );
  assert.equal(contents.some((content) => "status" in content), false);
  assert.equal(contents.some((content) => "credential" in content), false);
  assert.equal(
    harness.traceEvents.some(
      (event) => event.eventType === "native_session.resumed",
    ),
    true,
  );
});

// @nodekit-verifies inv:native-agent-session-identity#authenticated-owner-only
test("coding agent cannot supply workspace owner identity", async () => {
  const harness = createHarness();
  await assert.rejects(
    workspace_bind(harness.context, {
      caseId: harness.caseId,
      canonicalRemote: repository.canonicalRemote,
      writeMode: "read-only",
      ownerRef: "owner:attacker",
    }),
    (error) =>
      error instanceof NativeAgentSessionError
      && error.code === "CALLER_OWNER_FORBIDDEN",
  );
  assert.equal(harness.caseflow.snapshot().artifacts.length, 0);
});

// @nodekit-verifies inv:native-agent-session-identity#raw-provider-id-never-leaves-adapter
test("trusted adapter output containing a raw provider session ID is rejected before persistence", async () => {
  const harness = createHarness({
    startOutput(output) {
      return { ...output, providerSessionId: "raw-secret-session-id" };
    },
  });
  const workspace = await workspace_bind(harness.context, {
    caseId: harness.caseId,
    canonicalRemote: repository.canonicalRemote,
    writeMode: "read-only",
  });
  await assert.rejects(
    session_start(harness.context, {
      workspaceId: workspace.workspaceId,
      adapterId: "claude-code",
      writeScope: "read-only",
    }),
    (error) =>
      error instanceof NativeAgentSessionError
      && error.code === "RAW_PROVIDER_IDENTITY_EXPOSED",
  );
  assert.equal(
    JSON.stringify(harness.caseflow.snapshot()).includes(
      "raw-secret-session-id",
    ),
    false,
  );
});

// @nodekit-verifies inv:native-agent-session-identity#repository-substitution-fails-closed
test("repository movement blocks resume without writing a false checkpoint", async () => {
  const movedRepository = {
    ...repository,
    treeHash: "c".repeat(40),
  };
  const harness = createHarness({ repositoryAtResume: movedRepository });
  const { session, checkpoint } = await startWorkspaceAndSession(harness);
  const beforeCount = harness.caseflow.snapshot().artifacts.length;
  const result = await session_resume(harness.context, {
    sessionId: session.sessionId,
    expectedCheckpointDigest: checkpoint.artifactDigest,
  });
  assert.deepEqual(result, {
    state: "REPOSITORY_MISMATCH",
    reasonCode: "REPOSITORY_MISMATCH",
  });
  assert.equal(harness.caseflow.snapshot().artifacts.length, beforeCount);
  assert.equal(harness.leases.isBusy(`session:${session.sessionId}`), false);
});

// @nodekit-verifies inv:native-agent-session-identity#checkpoint-frontier-is-cas
test("analyst cannot checkpoint or resume from a stale frontier", async () => {
  const harness = createHarness();
  const { session, checkpoint } = await startWorkspaceAndSession(harness);
  await assert.rejects(
    session_checkpoint(harness.context, {
      sessionId: session.sessionId,
      expectedPreviousCheckpointDigest: hash("stale"),
    }),
    (error) =>
      error instanceof NativeAgentSessionError
      && error.code === "CHECKPOINT_STALE",
  );
  const resume = await session_resume(harness.context, {
    sessionId: session.sessionId,
    expectedCheckpointDigest: hash("stale"),
  });
  assert.equal(resume.state, "CHECKPOINT_INVALID");
  assert.equal(checkpoint.sequence, 0);
});

// @nodekit-verifies inv:native-agent-session-identity#single-resume-lease-winner
test("100 concurrent resume attempts across ten sessions produce one winner per session", async () => {
  const groups = await Promise.all(
    Array.from({ length: 10 }, async (_, index) => {
      const harness = createHarness({
        providerIdentity: `provider-session-${index}`,
        resumeDelayMs: 2,
      });
      const started = await startWorkspaceAndSession(harness);
      const attempts = await Promise.all(
        Array.from({ length: 10 }, () =>
          session_resume(harness.context, {
            sessionId: started.session.sessionId,
            expectedCheckpointDigest: started.checkpoint.artifactDigest,
          })),
      );
      return attempts;
    }),
  );
  for (const attempts of groups) {
    assert.equal(attempts.filter((result) => result.state === "RESUMED").length, 1);
    assert.equal(
      attempts.filter((result) => result.state === "SESSION_BUSY").length,
      9,
    );
  }
});

// @nodekit-verifies inv:native-agent-session-identity#adapter-timeout-fails-closed
test("degraded adapter timeout never returns RESUMED or leaks a lease", async () => {
  const harness = createHarness({
    timeoutMs: 10,
    resumeDelayMs: 100,
  });
  const { session, checkpoint } = await startWorkspaceAndSession(harness);
  const result = await session_resume(harness.context, {
    sessionId: session.sessionId,
    expectedCheckpointDigest: checkpoint.artifactDigest,
  });
  assert.equal(result.state, "BLOCKED_EXTERNAL");
  assert.equal(harness.leases.isBusy(`session:${session.sessionId}`), false);
});

// @nodekit-verifies inv:native-agent-session-identity#provider-hash-substitution
test("adapter cannot substitute another provider session during resume", async () => {
  const harness = createHarness({
    resumeOutput(output) {
      return { ...output, providerSessionIdHash: hash("another-provider") };
    },
  });
  const { session, checkpoint } = await startWorkspaceAndSession(harness);
  const result = await session_resume(harness.context, {
    sessionId: session.sessionId,
    expectedCheckpointDigest: checkpoint.artifactDigest,
  });
  assert.equal(result.state, "CHECKPOINT_INVALID");
  assert.equal(harness.leases.isBusy(`session:${session.sessionId}`), false);
});

// @nodekit-verifies inv:native-agent-session-identity#bounded-adapter-output
test("burst adapter output cannot persist an unbounded artifact digest list", async () => {
  const harness = createHarness({
    startOutput(output) {
      return {
        ...output,
        initialCheckpoint: {
          ...output.initialCheckpoint,
          artifactDigests: Array.from({ length: 257 }, (_, index) =>
            hash(`artifact:${index}`)),
        },
      };
    },
  });
  const workspace = await workspace_bind(harness.context, {
    caseId: harness.caseId,
    canonicalRemote: repository.canonicalRemote,
    writeMode: "read-only",
  });
  await assert.rejects(
    session_start(harness.context, {
      workspaceId: workspace.workspaceId,
      adapterId: "claude-code",
      writeScope: "read-only",
    }),
    (error) =>
      error instanceof NativeAgentSessionError
      && error.code === "BOUND_READ_EXCEEDED",
  );
});

// @nodekit-verifies inv:native-agent-session-identity#sustained-checkpoint-chain
test("sustained state retains 1,000 exact checkpoint predecessors with no generation field", async () => {
  const harness = createHarness();
  const { session, checkpoint } = await startWorkspaceAndSession(harness);
  let digest = checkpoint.artifactDigest;
  for (let index = 1; index <= 1_000; index += 1) {
    const next = await session_checkpoint(harness.context, {
      sessionId: session.sessionId,
      expectedPreviousCheckpointDigest: digest,
    });
    assert.equal(next.sequence, index);
    digest = next.checkpointDigest;
  }
  const contents = harness.caseflow.listCanonicalArtifactContents({
    limit: 2_000,
  });
  const checkpoints = contents.filter(
    (content) =>
      content.schemaVersion === "nodekit.native-session-checkpoint/v1",
  );
  assert.equal(checkpoints.length, 1_001);
  assert.equal(checkpoints.some((item) => "generation" in item), false);
  assert.equal(
    checkpoints[1_000].previousCheckpointDigest,
    checkpoints[999].artifactDigest,
  );
});
