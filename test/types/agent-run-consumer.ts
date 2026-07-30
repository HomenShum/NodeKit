import {
  AGENT_RUN_LIMITS,
  contentDigest,
  runAgent,
  type AgentRunGraph,
  type AgentRunReceipt,
  type AgentRunStatus,
} from "@homenshum/nodekit/agent-run";

const status: AgentRunStatus = "completed";
const graph: AgentRunGraph = {
  schemaVersion: "nodekit.agent-run-graph/v1",
  limits: { edges: 3, evidenceRefsPerNode: 3, nodes: 4 },
  nodes: [
    {
      detail: "Inspect the repository",
      endedAt: "2026-07-30T00:00:00.000Z",
      evidenceRefs: ["receipt.json#/goal"],
      id: "goal",
      kind: "goal",
      label: "Goal",
      startedAt: "2026-07-30T00:00:00.000Z",
      status,
    },
  ],
  edges: [],
  graphDigest: contentDigest({ nodes: [], edges: [] }),
};

void graph;
void AGENT_RUN_LIMITS.argsBytes;
void contentDigest({ graph });

const result = runAgent({
  agent: "consumer",
  goal: "Verify the public recorder contract",
  program: "node",
  args: ["--version"],
});

void result.then(({ receipt }) => {
  const typedReceipt: AgentRunReceipt = receipt;
  const digest: string = typedReceipt.receiptDigest;
  const graphVersion: "nodekit.agent-run-graph/v1" = typedReceipt.graph.schemaVersion;
  void digest;
  void graphVersion;
});
