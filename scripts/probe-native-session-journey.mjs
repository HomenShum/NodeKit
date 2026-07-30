import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (value.startsWith("--")) pairs.push([value.slice(2), values[index + 1]]);
  return pairs;
}, []));
const moduleRoot = path.resolve(args["module-root"] ?? process.cwd());
const request = {
  intendedGoal: "Resume the exact coding-agent session after a desktop restart without substituting repository or provider identity.",
  operation: "workspace_bind -> session_start -> session_status -> session_resume",
  input: {
    canonicalRemote: "https://github.com/example/native-session.git",
    writeMode: "isolated-worktree",
    adapterId: "claude-code",
  },
};

let response;
try {
  const caseflowRuntime = await import(pathToFileURL(path.join(moduleRoot, "src", "lib", "caseflow.mjs")).href);
  const nativeRuntime = await import(pathToFileURL(path.join(moduleRoot, "src", "native-agent-identity.mjs")).href);
  const hash = (value) => caseflowRuntime.contentHash({ value });
  const repository = {
    canonicalRemote: request.input.canonicalRemote,
    commit: "a".repeat(40),
    treeHash: "b".repeat(40),
    dirty: true,
    dirtyWorkingTreeHash: hash("dirty-tree"),
  };
  const nonceHash = (nonce) => caseflowRuntime.contentHash({
    schemaVersion: "nodekit.native-operation-nonce/v1",
    nonce,
  });
  const receipt = (kind, nonce) => {
    const operationNonceHash = nonceHash(nonce);
    return {
      ref: `receipt:${kind}:${operationNonceHash.slice(0, 16)}`,
      digest: hash(`${kind}:${operationNonceHash}`),
      operationNonceHash,
      verified: true,
    };
  };
  const checkpointOutput = (kind, nonce, sequence) => ({
    resumeCursorHash: hash(`cursor:${sequence}`),
    repository,
    traceDigest: hash(`trace:${sequence}`),
    artifactDigests: [hash(`artifact:${sequence}`)],
    receipt: receipt(kind, nonce),
  });
  let tick = 0;
  const clock = () => new Date(Date.UTC(2026, 6, 30, 10, 0, tick++)).toISOString();
  const caseflow = caseflowRuntime.createMemoryCaseflow({ ownerId: "owner:authenticated", clock });
  const createdCase = caseflow.createCase({
    title: "Resume a coding workspace",
    primaryJob: "Continue the exact coding-agent session",
    actor: { type: "user", id: "owner:authenticated" },
  });
  caseflow.startRun({
    caseId: createdCase.caseId,
    stages: [{ id: "build", label: "Build", owner: "agent" }],
    actor: { type: "system", id: "nodekit" },
  });
  const providerSessionIdHash = hash("private-provider-session");
  const held = new Map();
  const context = {
    caseflow,
    clock,
    timeoutMs: 1_000,
    repository: {
      async measure({ operationNonce }) {
        return { repository, receipt: receipt("repository-bind", operationNonce) };
      },
      async measureCurrent({ operationNonce }) {
        return { repository, receipt: receipt("repository-resume", operationNonce) };
      },
    },
    adapters: {
      get(adapterId) {
        if (adapterId !== request.input.adapterId) return undefined;
        return {
          async start({ operationNonce }) {
            return {
              providerSessionIdHash,
              adapterVersion: "claude-code-adapter:proof",
              harnessVersion: "nodekit-harness:proof",
              creationReceipt: receipt("session-created", operationNonce),
              initialCheckpoint: checkpointOutput("initial-checkpoint", operationNonce, 0),
              runHandle: "run-handle:start",
            };
          },
          async resume({ checkpoint, operationNonce }) {
            return {
              providerSessionIdHash,
              resumeCursorHash: checkpoint.resumeCursorHash,
              resumeReceipt: receipt("session-resumed", operationNonce),
              newCheckpoint: checkpointOutput("resumed-checkpoint", operationNonce, checkpoint.sequence + 1),
              runHandle: `run-handle:resume:${checkpoint.sequence + 1}`,
            };
          },
        };
      },
    },
    leases: {
      async acquire({ keys, owner }) {
        if (keys.some((key) => held.has(key))) return { acquired: false };
        for (const key of keys) held.set(key, owner);
        return { acquired: true, keys, owner };
      },
      async release(lease) {
        for (const key of lease.keys ?? []) if (held.get(key) === lease.owner) held.delete(key);
      },
    },
    trace: { async record() {} },
  };
  const workspace = await nativeRuntime.workspace_bind(context, {
    caseId: createdCase.caseId,
    canonicalRemote: request.input.canonicalRemote,
    writeMode: request.input.writeMode,
  });
  const session = await nativeRuntime.session_start(context, {
    workspaceId: workspace.workspaceId,
    adapterId: request.input.adapterId,
    writeScope: request.input.writeMode,
  });
  const checkpoint = caseflow.listCanonicalArtifactContents({ limit: 100 })
    .find((content) => content.schemaVersion === "nodekit.native-session-checkpoint/v1");
  const beforeResume = await nativeRuntime.session_status(context, { sessionId: session.sessionId });
  const resumed = await nativeRuntime.session_resume(context, {
    sessionId: session.sessionId,
    expectedCheckpointDigest: checkpoint.artifactDigest,
  });
  const artifacts = caseflow.listCanonicalArtifactContents({ limit: 100 })
    .filter((content) => content.schemaVersion.startsWith("nodekit.native"));
  response = {
    ok: true,
    workspaceDisposition: workspace.disposition,
    sessionDisposition: session.disposition,
    stateBeforeResume: beforeResume.derivedState,
    resumeState: resumed.state,
    durableNewCheckpoint: resumed.newCheckpointRef.startsWith("native-session-checkpoint:sha256:"),
    canonicalArtifactTypes: artifacts.map((artifact) => artifact.schemaVersion),
    persistedRawProviderIdentity: JSON.stringify(artifacts).includes("private-provider-session"),
    persistedCallerOwnedStatus: artifacts.some((artifact) => "status" in artifact),
  };
} catch (error) {
  response = {
    ok: false,
    error: { name: error.name, code: error.code ?? null, message: error.message },
  };
}

const output = `${JSON.stringify({
  schemaVersion: "nodekit.live-io-evidence/v1",
  runtimeScope: "package-live-runtime",
  deployedBackend: false,
  moduleRoot,
  request,
  response,
}, null, 2)}\n`;
if (args.out) await writeFile(path.resolve(args.out), output);
else process.stdout.write(output);
