import {
  session_checkpoint,
  session_resume,
  session_start,
  session_status,
  workspace_bind,
  type NativeAgentSessionContext,
  type NativeSessionResumeResult,
  type NativeWriteScope,
} from "@homenshum/nodekit/native-agent-identity";
import { workspace_bind as workspaceBindFromRoot } from "@homenshum/nodekit";

declare const context: NativeAgentSessionContext;

const writeScope: NativeWriteScope = "isolated-worktree";
const workspace = await workspace_bind(context, {
  caseId: "case:nodekit",
  canonicalRemote: "https://github.com/HomenShum/node-platform.git",
  writeMode: writeScope,
});
workspaceBindFromRoot satisfies typeof workspace_bind;

const session = await session_start(context, {
  workspaceId: workspace.workspaceId,
  adapterId: "codex",
  writeScope,
});
const status = await session_status(context, { sessionId: session.sessionId });
status.limitations satisfies string[];

const checkpoint = await session_checkpoint(context, {
  sessionId: session.sessionId,
  expectedPreviousCheckpointDigest: "a".repeat(64),
});
checkpoint.sequence satisfies number;

const resumed: NativeSessionResumeResult = await session_resume(context, {
  sessionId: session.sessionId,
  expectedCheckpointDigest: checkpoint.checkpointDigest,
});
if (resumed.state === "RESUMED") {
  resumed.newCheckpointRef satisfies string;
} else {
  resumed.reasonCode satisfies string;
}
