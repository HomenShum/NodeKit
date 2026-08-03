// A reader once opened this package's exports, saw Convex, caseflow and studio, concluded
// "Convex-shaped, skip it", and missed the reference loop and the design contract entirely. That is
// a discoverability failure, not a judgement failure: the manifest is organised around what NodeKit
// HAS, and the only question a new project asks is what NodeKit OFFERS IT.
//
// So this is the inverse index. Each surface says which stacks it applies to and, more importantly,
// which it does not and why — because "these eleven do not apply to you" is the sentence that lets
// someone stop reading, and the absence of that sentence is what makes a large CLI look like
// somebody else's tool.
//
// `appliesTo: "any"` means the surface is stack-independent: it takes files, JSON records or a git
// history, and does not care what the project is written in. Anything else lists concrete stacks.

export const STACKS = Object.freeze([
  "any",
  "node",
  "convex",
  "python",
  "postgres",
  "supabase",
  "frontend",
]);

/**
 * One entry per surface a consumer could adopt. `entry` is what they type or import; `gate` marks
 * the surfaces that refuse work rather than merely producing it, because those are the ones worth
 * knowing about first and the ones a skim reliably misses.
 */
export const SURFACES = Object.freeze([
  {
    id: "reference-loop",
    entry: "@homenshum/nodekit/reference-loop",
    gate: true,
    appliesTo: ["any"],
    offers: "Record what a reference product actually does as cited facts, derive design rules from them, and score a candidate against those rules. Refuses prose observations and citations that resolve to nothing.",
  },
  {
    id: "reference-corpus-gate",
    entry: "npx nodekit-reference-corpus-gate [corpusDir] [--repo-root <path>]",
    gate: true,
    appliesTo: ["any"],
    offers: "Fail a design contract whose rules terminate in nothing checkable, or whose termination refs point at artifacts that no longer exist. Resolves refs against your repository, not this package.",
  },
  {
    id: "design-rule",
    entry: "schemas/nodekit.design-rule.v1.schema.json",
    gate: true,
    appliesTo: ["any"],
    offers: "A design rule that must name where it terminates: a schema field, a renderer assertion, a test, or an explicit none with a reason.",
  },
  {
    id: "evolution-ledger",
    entry: "nodekit graph / evolution records",
    gate: true,
    appliesTo: ["any"],
    offers: "Events, assumptions and invariants with evidence behind them. An assumption that generalises must name the axis its evidence measured.",
  },
  {
    id: "journey-chain",
    entry: "@homenshum/nodekit build/story/launch evidence packs",
    gate: true,
    appliesTo: ["any"],
    offers: "DECIDE to LEARN stage artifacts that must chain by digest, and refuse a stage claiming completeness it cannot show.",
  },
  {
    id: "governance",
    entry: "@homenshum/nodekit/governance",
    gate: true,
    appliesTo: ["any"],
    offers: "Risk classification, before/after change evidence, rollback receipts, and a provenance surface where each element is cited or declared novel.",
  },
  {
    id: "submission-attestation",
    entry: "@homenshum/nodekit/submission-attestation",
    gate: true,
    appliesTo: ["any"],
    offers: "Detached signatures over a submission's evidence, verified independently of the process that produced it. Also on the CLI as npx nodekit-attestation-sign and npx nodekit-attestation-verify.",
  },
  {
    id: "production-gate",
    entry: "@homenshum/nodekit/production-gate",
    gate: true,
    appliesTo: ["any"],
    offers: "Seven fail-closed checks before real user data is on the line — secret boundary, server authorization, tenant isolation, error observability, restore proof, change regression, payment integrity. Absence is NOT_RUN and NOT_RUN blocks; the party that built the application may not certify or waive it.",
  },
  {
    id: "frame-evidence",
    entry: "@homenshum/nodekit/frame-evidence",
    gate: true,
    appliesTo: ["any"],
    offers: "Deterministic checks on captured frames before any model reviews them: a live-product frame binds to deployment revision, browser trace, journey state and its own screenshot hash; a generated frame may never be presented as the running application.",
  },
  {
    id: "delivery-brief",
    entry: "@homenshum/nodekit/delivery-brief",
    gate: true,
    appliesTo: ["any"],
    offers: "Compile a finished build into a launch brief whose every claim cites evidence the BuildEvidencePack actually contains — a claim citing an id the pack lacks is an invented capability. Also refuses three story directions that are one direction with three titles.",
  },
  {
    id: "knockout",
    entry: "@homenshum/nodekit/knockout",
    gate: true,
    appliesTo: ["any"],
    offers: "Causal necessity by removal: prove a mechanism is responsible rather than merely present. Refuses fast-forward and duration-zeroed knockouts by name, and refuses one whose observation equals the baseline's terminal state.",
  },
  {
    id: "agent-run",
    entry: "@homenshum/nodekit/agent-run",
    appliesTo: ["any"],
    offers: "Run any subprocess agent under a timeout and capture what it actually did as a replayable record.",
  },
  {
    id: "builder-gym",
    entry: "@homenshum/nodekit/builder-gym",
    appliesTo: ["any"],
    offers: "Score a change set against recorded builder cases instead of against an opinion.",
  },
  {
    id: "caseflow",
    entry: "@homenshum/nodekit/caseflow",
    appliesTo: ["convex", "node"],
    offers: "Durable case state with optimistic concurrency.",
    doesNotApply: "Needs a runtime offering durable state and transactions. Use the postgres adapter, or skip: nothing else here depends on it.",
  },
  {
    id: "convex-component",
    entry: "@homenshum/nodekit/convex.config",
    appliesTo: ["convex"],
    offers: "Caseflow as an installable Convex component.",
    doesNotApply: "Convex only. This is the surface most often mistaken for the whole package.",
  },
  {
    id: "postgres-adapter",
    entry: "@homenshum/nodekit/adapters/postgres",
    appliesTo: ["postgres"],
    offers: "Caseflow and knowledge schemas as SQL migrations.",
    doesNotApply: "Postgres only.",
  },
  {
    id: "supabase-adapter",
    entry: "@homenshum/nodekit/adapters/supabase/profile.sql",
    appliesTo: ["supabase"],
    offers: "Profile and worker tables for Supabase deployments.",
    doesNotApply: "Supabase only.",
  },
  {
    id: "studio",
    entry: "@homenshum/nodekit/studio",
    appliesTo: ["node", "frontend"],
    offers: "The authoring surface for NodeKit-generated applications.",
    doesNotApply: "Assumes a generated NodeKit application; it is not a general library.",
  },
  {
    id: "frontend-render-contract",
    entry: "nodekit frontend plan|directions|benchmark|canary",
    gate: true,
    appliesTo: ["frontend"],
    offers: "Compare rendered directions against a protected product contract, with a render receipt a candidate cannot issue for itself.",
    doesNotApply: "Needs a browsable frontend to render and inspect.",
  },
  {
    id: "knowledge-runtime",
    entry: "@homenshum/nodekit/knowledge-runtime",
    appliesTo: ["node", "postgres"],
    offers: "Retrieval over a knowledge graph with a comparison harness.",
    doesNotApply: "Needs a Node process; the storage half needs Postgres.",
  },
]);

/** Surfaces are relevant when they are stack-independent, or when they name the stack asked about. */
export function explainFor(stack) {
  if (!STACKS.includes(stack)) {
    const error = new Error(`unknown stack "${stack}"; known stacks: ${STACKS.join(", ")}`);
    error.code = "UNKNOWN_STACK";
    throw error;
  }
  const applies = (surface) => surface.appliesTo.includes("any") || (stack !== "any" && surface.appliesTo.includes(stack));
  const relevant = SURFACES.filter(applies);
  return {
    stack,
    // Gates first: they are what a skim misses, and they are the reason to adopt any of this.
    relevant: [...relevant].sort((a, b) => Number(Boolean(b.gate)) - Number(Boolean(a.gate)) || a.id.localeCompare(b.id)),
    notRelevant: SURFACES.filter((surface) => !applies(surface)),
  };
}

export function formatExplanation({ stack, relevant, notRelevant }) {
  const lines = [`NodeKit for ${stack}: ${relevant.length} surface(s) apply, ${notRelevant.length} do not.`, ""];
  lines.push(`APPLIES (${relevant.length})`);
  for (const surface of relevant) {
    lines.push(`  ${surface.gate ? "[gate] " : "       "}${surface.id}`);
    lines.push(`          ${surface.entry}`);
    lines.push(`          ${surface.offers}`);
  }
  lines.push("", `DOES NOT APPLY (${notRelevant.length}) — you can stop reading these`);
  for (const surface of notRelevant) {
    lines.push(`  ${surface.id}: ${surface.doesNotApply}`);
  }
  return lines.join("\n");
}
