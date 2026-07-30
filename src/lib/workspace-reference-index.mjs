import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
} from "node:fs/promises";
import path from "node:path";

const STATE_SCHEMA = "nodekit.workspace-reference-index/v1";
const SHA256 = /^[a-f0-9]{64}$/u;
const WORKSPACE_ID = /^workspace:sha256:[a-f0-9]{64}$/u;
const SESSION_ID = /^session:sha256:[a-f0-9]{64}$/u;
const MAX_ENTRIES = 256;
const MAX_BYTES = 262_144;
const MAX_PENDING_WRITES = 64;
const writeQueues = new Map();

function fail(message) {
  throw new TypeError(`workspace reference index: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value, label, pattern = null) {
  if (typeof value !== "string" || value.length === 0 || value.length > 1_024) {
    fail(`${label} must be bounded non-empty text`);
  }
  if (pattern && !pattern.test(value)) fail(`${label} is invalid`);
  return value;
}

function hash(value, label) {
  return text(value, label, SHA256);
}

function timestamp(value, label) {
  text(value, label);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    fail(`${label} must be canonical UTC ISO-8601`);
  }
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
  );
}

function digest(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)), "utf8")
    .digest("hex");
}

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function paths(repoRoot) {
  const root = path.resolve(repoRoot);
  const directory = path.join(root, ".nodekit", "workspace-reference-index");
  return { directory, state: path.join(directory, "index.json") };
}

async function rejectSymlink(target, label) {
  try {
    const metadata = await lstat(target);
    if (metadata.isSymbolicLink()) fail(`${label} cannot be a symlink`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function enqueueWrite(key, operation) {
  const current = writeQueues.get(key) ?? {
    pending: 0,
    tail: Promise.resolve(),
  };
  if (current.pending >= MAX_PENDING_WRITES) {
    fail(`pending write count exceeds ${MAX_PENDING_WRITES}`);
  }
  current.pending += 1;
  const run = current.tail.then(operation, operation);
  current.tail = run.catch(() => {});
  writeQueues.set(key, current);
  try {
    return await run;
  } finally {
    current.pending -= 1;
    if (current.pending === 0 && writeQueues.get(key) === current) {
      writeQueues.delete(key);
    }
  }
}

function artifactMap(artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length > 4_096) {
    fail("caseflowArtifacts must contain at most 4096 canonical artifacts");
  }
  const byRef = new Map();
  for (const [index, artifact] of artifacts.entries()) {
    if (!isRecord(artifact)) fail(`caseflowArtifacts[${index}] must be an object`);
    const artifactRef = text(
      artifact.artifactRef,
      `caseflowArtifacts[${index}].artifactRef`,
    );
    const artifactDigest = hash(
      artifact.artifactDigest,
      `caseflowArtifacts[${index}].artifactDigest`,
    );
    if (byRef.has(artifactRef)) fail(`duplicate artifactRef: ${artifactRef}`);
    byRef.set(artifactRef, { ...artifact, artifactDigest, artifactRef });
  }
  return byRef;
}

function compileEntries(artifacts) {
  const byRef = artifactMap(artifacts);
  const workspaces = [...byRef.values()].filter(
    (artifact) => artifact.schemaVersion === "nodekit.native-workspace/v1",
  );
  const sessions = [...byRef.values()].filter(
    (artifact) => artifact.schemaVersion === "nodekit.native-agent-session/v1",
  );
  const checkpoints = [...byRef.values()].filter(
    (artifact) => artifact.schemaVersion === "nodekit.native-session-checkpoint/v1",
  );
  const entries = [];
  for (const workspace of workspaces) {
    const workspaceId = text(workspace.workspaceId, "workspaceId", WORKSPACE_ID);
    const matchingSessions = sessions.filter(
      (session) =>
        session.workspaceArtifactRef === workspace.artifactRef
        && session.workspaceArtifactDigest === workspace.artifactDigest,
    );
    if (matchingSessions.length === 0) {
      entries.push({
        workspaceId,
        workspaceArtifactRef: workspace.artifactRef,
        workspaceArtifactDigest: workspace.artifactDigest,
      });
      continue;
    }
    for (const session of matchingSessions) {
      const sessionId = text(session.sessionId, "sessionId", SESSION_ID);
      const matchingCheckpoints = checkpoints
        .filter(
          (checkpoint) =>
            checkpoint.sessionArtifactRef === session.artifactRef
            && checkpoint.sessionArtifactDigest === session.artifactDigest,
        )
        .map((checkpoint) => {
          if (
            !Number.isSafeInteger(checkpoint.sequence)
            || checkpoint.sequence < 0
          ) {
            fail("checkpoint sequence must be a non-negative safe integer");
          }
          return checkpoint;
        })
        .sort((left, right) => {
          return (
            left.sequence - right.sequence
            || compareCodeUnits(left.artifactRef, right.artifactRef)
          );
        });
      const latest = matchingCheckpoints.at(-1);
      entries.push({
        workspaceId,
        sessionId,
        workspaceArtifactRef: workspace.artifactRef,
        workspaceArtifactDigest: workspace.artifactDigest,
        sessionArtifactRef: session.artifactRef,
        sessionArtifactDigest: session.artifactDigest,
        ...(latest
          ? {
              latestCheckpointRef: latest.artifactRef,
              latestCheckpointDigest: latest.artifactDigest,
            }
          : {}),
      });
    }
  }
  if (entries.length > MAX_ENTRIES) fail(`entry count exceeds ${MAX_ENTRIES}`);
  return entries.sort((left, right) =>
    compareCodeUnits(
      `${left.workspaceId}|${left.sessionId ?? ""}`,
      `${right.workspaceId}|${right.sessionId ?? ""}`,
    ));
}

function verifyEntry(entry, index) {
  if (!isRecord(entry)) fail(`entries[${index}] must be an object`);
  const allowed = new Set([
    "workspaceId",
    "sessionId",
    "workspaceArtifactRef",
    "workspaceArtifactDigest",
    "sessionArtifactRef",
    "sessionArtifactDigest",
    "latestCheckpointRef",
    "latestCheckpointDigest",
  ]);
  if (Object.keys(entry).some((key) => !allowed.has(key))) {
    fail(`entries[${index}] contains an authority-bearing field`);
  }
  text(entry.workspaceId, `entries[${index}].workspaceId`, WORKSPACE_ID);
  text(entry.workspaceArtifactRef, `entries[${index}].workspaceArtifactRef`);
  hash(entry.workspaceArtifactDigest, `entries[${index}].workspaceArtifactDigest`);
  const sessionFields = [
    entry.sessionId,
    entry.sessionArtifactRef,
    entry.sessionArtifactDigest,
  ];
  if (sessionFields.some((value) => value !== undefined)) {
    if (sessionFields.some((value) => value === undefined)) {
      fail(`entries[${index}] session reference tuple is incomplete`);
    }
    text(entry.sessionId, `entries[${index}].sessionId`, SESSION_ID);
    text(entry.sessionArtifactRef, `entries[${index}].sessionArtifactRef`);
    hash(entry.sessionArtifactDigest, `entries[${index}].sessionArtifactDigest`);
  }
  const checkpointFields = [
    entry.latestCheckpointRef,
    entry.latestCheckpointDigest,
  ];
  if (checkpointFields.some((value) => value !== undefined)) {
    if (
      sessionFields.some((value) => value === undefined)
      || checkpointFields.some((value) => value === undefined)
    ) {
      fail(`entries[${index}] checkpoint reference tuple is incomplete`);
    }
    text(entry.latestCheckpointRef, `entries[${index}].latestCheckpointRef`);
    hash(entry.latestCheckpointDigest, `entries[${index}].latestCheckpointDigest`);
  }
}

export function verifyWorkspaceReferenceIndex(state) {
  if (!isRecord(state)) fail("state must be an object");
  const keys = Object.keys(state).sort();
  const expected = [
    "builtAt",
    "builtFromCaseflowDigest",
    "entries",
    "indexDigest",
    "schemaVersion",
  ].sort();
  if (
    keys.length !== expected.length
    || keys.some((key, index) => key !== expected[index])
  ) {
    fail("state has unknown or missing fields");
  }
  if (state.schemaVersion !== STATE_SCHEMA) fail("schemaVersion is invalid");
  hash(state.builtFromCaseflowDigest, "builtFromCaseflowDigest");
  timestamp(state.builtAt, "builtAt");
  if (!Array.isArray(state.entries) || state.entries.length > MAX_ENTRIES) {
    fail(`entries must contain at most ${MAX_ENTRIES} items`);
  }
  state.entries.forEach(verifyEntry);
  const expectedDigest = digest({
    schemaVersion: state.schemaVersion,
    builtFromCaseflowDigest: state.builtFromCaseflowDigest,
    builtAt: state.builtAt,
    entries: state.entries,
  });
  if (state.indexDigest !== expectedDigest) fail("indexDigest is invalid");
  return state;
}

export async function buildWorkspaceReferenceIndex(repoRoot, input) {
  if (!isRecord(input)) fail("input must be an object");
  const body = {
    schemaVersion: STATE_SCHEMA,
    builtFromCaseflowDigest: hash(
      input.builtFromCaseflowDigest,
      "builtFromCaseflowDigest",
    ),
    builtAt: timestamp(input.builtAt, "builtAt"),
    entries: compileEntries(input.caseflowArtifacts),
  };
  const state = verifyWorkspaceReferenceIndex({
    ...body,
    indexDigest: digest(body),
  });
  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  if (Buffer.byteLength(serialized) > MAX_BYTES) fail("index exceeds byte bound");
  const target = paths(repoRoot);
  await enqueueWrite(target.directory, async () => {
    await rejectSymlink(target.directory, "workspace-reference-index");
    await mkdir(target.directory, { recursive: true });
    await rejectSymlink(target.state, "index.json");
    // This cache is intentionally disposable. The bounded in-process queue
    // prevents torn concurrent writes; a process crash may leave a malformed
    // cache, which the fail-closed reader rejects so Caseflow can rebuild it.
    const handle = await open(target.state, "w", 0o600);
    try {
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  });
  return state;
}

export async function readWorkspaceReferenceIndex(repoRoot) {
  const target = paths(repoRoot);
  await rejectSymlink(target.directory, "workspace-reference-index");
  await rejectSymlink(target.state, "index.json");
  const data = await readFile(target.state);
  if (data.byteLength > MAX_BYTES) fail("index exceeds byte bound");
  let parsed;
  try {
    parsed = JSON.parse(data.toString("utf8"));
  } catch {
    fail("index contains invalid JSON");
  }
  return verifyWorkspaceReferenceIndex(parsed);
}

export const WORKSPACE_REFERENCE_INDEX_LIMITS = Object.freeze({
  maxArtifacts: 4_096,
  maxEntries: MAX_ENTRIES,
  maxPendingWrites: MAX_PENDING_WRITES,
  maxRecordBytes: MAX_BYTES,
});
