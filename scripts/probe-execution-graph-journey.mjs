import { pathToFileURL } from "node:url";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (value.startsWith("--")) pairs.push([value.slice(2), values[index + 1]]);
  return pairs;
}, []));
const moduleRoot = path.resolve(args["module-root"] ?? process.cwd());
const modulePath = path.join(moduleRoot, "src", "execution-graph.mjs");
const request = {
  intendedGoal: "Turn an approved brownfield journey into a bounded, inspectable execution plan.",
  operation: "compileExecutionGraph",
  input: {
    projectRef: "caseflow:proof-pr-32",
    projectRevision: "proof-candidate",
    approvedJourneyRef: `approved-journey:sha256:${"a".repeat(64)}`,
    approvedJourneyDigest: "a".repeat(64),
    designContext: {
      primaryUser: "NodeKit builder",
      primaryArtifact: "verified brownfield change",
      primaryAction: "deliver with bounded proof",
      requiredFlows: ["build -> verify -> deliver"],
      requiredStates: ["ready", "complete"],
      approvedProductTopology: ["Caseflow remains canonical"],
      designRules: [],
      tokenRoles: [],
      trustSurfaces: ["NodeProof"],
      responsiveBehavior: [],
      motionRules: [],
      copyRules: ["Plain-language status"],
      antiPatterns: ["Unbounded orchestration"],
      knownNovelDecisions: ["Disposable execution graph"],
      proofRequirements: ["Every runnable task is bounded"],
    },
    nodes: [{
      id: "deliver",
      type: "DELIVER",
      title: "Deliver the bounded change",
      authority: "reviewer",
      maximumAttempts: 1,
      expectedArtifact: {
        schemaVersion: "nodekit.delivery-receipt/v1",
        kind: "delivery-receipt",
        authority: "agent-produced",
        completeness: "complete",
        limitations: [],
      },
      readSet: ["proof/aggregate.json"],
      writeSet: [],
      externalSystems: [],
    }],
    edges: [],
  },
};

let response;
try {
  const runtime = await import(pathToFileURL(modulePath).href);
  const graph = runtime.compileExecutionGraph(request.input);
  const trace = runtime.createExecutionTrace(graph);
  response = {
    ok: true,
    graphId: graph.graphId,
    graphDigest: graph.graphDigest,
    canonicalState: graph.policy.canonicalState,
    automaticPromotion: graph.policy.automaticPromotion,
    nodeCount: graph.nodes.length,
    runnableTaskIds: runtime.deriveRunnableFrontier(graph, trace).map((node) => node.nodeId),
    maximumAttempts: graph.nodes[0].maximumAttempts,
  };
} catch (error) {
  response = {
    ok: false,
    error: {
      name: error.name,
      code: error.code ?? null,
      message: error.message,
    },
  };
}

const output = `${JSON.stringify({
  schemaVersion: "nodekit.live-io-evidence/v1",
  runtimeScope: "package-live-runtime",
  deployedBackend: false,
  modulePath,
  request,
  response,
}, null, 2)}\n`;
if (args.out) await writeFile(path.resolve(args.out), output);
else process.stdout.write(output);
