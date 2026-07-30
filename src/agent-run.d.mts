export interface AgentRunOptions {
  agent: string;
  goal: string;
  program: string;
  args?: string[];
  out?: string;
  timeoutMs?: number;
  cwd?: string;
}

export interface AgentRunStream {
  observedBytes: number;
  retainedBytes: number;
  text: string;
  truncated: boolean;
  retainedDigest: string;
  fullDigest: string;
}

export type AgentRunStatus = "completed" | "failed" | "timeout";

export interface AgentRunGraphNode {
  detail: string;
  endedAt: string;
  evidenceRefs: string[];
  id: string;
  kind: "evidence" | "goal" | "outcome" | "process";
  label: string;
  startedAt: string;
  status: AgentRunStatus;
}

export interface AgentRunGraph {
  schemaVersion: "nodekit.agent-run-graph/v1";
  limits: { edges: number; evidenceRefsPerNode: number; nodes: number };
  nodes: AgentRunGraphNode[];
  edges: Array<{ from: string; id: string; relation: string; to: string }>;
  graphDigest: string;
}

export interface AgentRunReceipt {
  schemaVersion: "nodekit.agent-run/v1";
  agent: { label: string };
  command: { args: string[]; program: string; shell: false };
  digests: Record<"command" | "events" | "goal" | "stderr" | "stdout", string>;
  durationMs: number;
  endedAt: string;
  events: Array<{ at: string; message: string; type: string }>;
  goal: string;
  graph: AgentRunGraph;
  io: { stderr: AgentRunStream; stdout: AgentRunStream };
  limits: {
    agentCharacters: number;
    argCharacters: number;
    args: number;
    argsBytes: number;
    events: number;
    goalCharacters: number;
    graphEdges: number;
    graphNodes: number;
    outputBytesPerStream: number;
    programCharacters: number;
    retention: number;
    timeoutMs: number;
  };
  outcome: { summary: string };
  process: { error: string | null; exitCode: number | null; signal: string | null };
  runId: string;
  sessionId: string;
  startedAt: string;
  status: AgentRunStatus;
  workspaceId: string;
  limitations: string[];
  receiptDigest: string;
}

export const AGENT_RUN_LIMITS: Readonly<{
  args: 256;
  argChars: 8192;
  argsBytes: 65536;
  agentChars: 128;
  events: 128;
  goalChars: 4096;
  graphEdges: 3;
  graphNodes: 4;
  outputBytes: 262144;
  pathBytes: 16384;
  programChars: 1024;
  retention: 50;
  timeoutMaxMs: 600000;
  timeoutMinMs: 100;
}>;

export function stableStringify(value: unknown): string;
export function contentDigest(value: unknown): string;
export function runAgent(options: AgentRunOptions): Promise<{
  receipt: AgentRunReceipt;
  receiptPath: string;
  reportPath: string;
}>;
