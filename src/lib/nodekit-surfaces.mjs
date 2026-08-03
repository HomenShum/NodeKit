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
    id: "atlas",
    entry: "nodekit atlas init | add | list | inspect | search | preview | recipe | repair | serve --mcp",
    gate: false,
    appliesTo: ["any"],
    offers: "Register design assets and flows, retrieve them by search or id, and serve them to a coding agent over MCP. `recipe` and `repair` turn a registered asset back into the steps that produce it.",
  },
  {
    id: "reference-provider",
    entry: "nodekit reference observe | rule | score | verify | status",
    gate: true,
    appliesTo: ["any", "frontend"],
    offers: "The reference loop as CLI: record what a reference product does as cited observations, derive rules, score a candidate render receipt against them, and verify a score. `status` reports whether the external provider was reachable, so a degraded fetch is a recorded state rather than a silent gap.",
  },
  {
    id: "knowledge-evolution",
    entry: "nodekit evolution init | draft | record | verify | query | diff | materiality | defer-review | build-docs | sync-graph",
    gate: true,
    appliesTo: ["any"],
    offers: "A governed record of what changed and why it was allowed to. `materiality` and `diff` compare two commits; `defer-review` demands live before/after evidence and a rollback verification before a deferral is accepted.",
  },
  {
    id: "harness-gym",
    entry: "nodekit harness init | builder | trajectory | tournament | gate | baseline | status | rollback",
    gate: true,
    appliesTo: ["any"],
    offers: "Lock a baseline agent trajectory and evaluate a candidate against it, with the lock hash supplied by the caller so a candidate cannot quietly re-baseline itself. `tournament` runs a manifest of candidates.",
  },
  {
    id: "skill-lifecycle",
    entry: "nodekit skills propose | review | benchmark | promote | reject | sync",
    gate: true,
    appliesTo: ["any"],
    offers: "Propose a skill, benchmark it against a comparison, and promote it only with a canary receipt, a proof receipt and a signed approval — promotion takes four artifacts rather than a decision. `sync` refreshes the skills projected into a generated project.",
  },
  {
    id: "model-routing",
    entry: "nodekit models baseline | profile | inspect | diagnose  ·  nodekit routing compile | canary",
    gate: false,
    appliesTo: ["any"],
    offers: "Profile models against a baseline and compile a routing matrix from the result, with `canary` checking a routing receipt before it takes effect. `diagnose` explains why a route was chosen rather than only which.",
  },
  {
    id: "audience-gate",
    entry: "nodekit audience check",
    gate: true,
    appliesTo: ["any"],
    offers: "Refuse a design decided before its audience was researched, and refuse a technology stated as fact that was only inferred. A late reframe is not evidence: switching stacks after seeing what a reviewer builds must cite evidence at least as strong as what established the original choice.",
  },
  {
    id: "walkthrough-clip",
    entry: "feature-walkthrough-gif: npm run capture | studio | render | judge",
    gate: true,
    appliesTo: ["frontend", "node"],
    doesNotApply: "A project with no interface to walk through has nothing to capture; the deck and evidence surfaces still apply.",
    offers: "Turn a live flow into a rendered walkthrough rather than a screen recording: zoom-to-focus camera, cursor with click ripples, step captions, and the loading and streaming captured live. `judge` scores two orthogonal axes — CRAFT (cursor, pacing, legibility, motion) and COMPREHENSION (persona, purpose, use case, feature, full interaction, responsiveness, flow, result, non-expert sense, transfer). A cut can be well made and incomprehensible, so the mom test blocks on its own. Render, judge, recut, judge again is the default loop rather than a final check.",
  },
  {
    id: "motion-compare",
    entry: "nodekit motion compare <repoA> <repoB> [repoC ...]",
    gate: false,
    appliesTo: ["frontend"],
    doesNotApply: "A project with no rendered interface has no motion vocabulary to compare; there is nothing here for a backend or CLI-only repository.",
    offers: "Compare motion vocabulary across repositories and emit a receipt, so drift between products is measured rather than argued about from memory.",
  },
  {
    id: "governance-visualize",
    entry: "nodekit governance visualize",
    gate: false,
    appliesTo: ["any"],
    offers: "Render the governance state — who approved what, and which gates a change passed — as a page a reviewer can read without running anything.",
  },
  {
    id: "session-migrate",
    entry: "nodekit session migrate-legacy --input <legacy.json>",
    gate: false,
    appliesTo: ["any"],
    offers: "Convert a legacy session record into the current native-session format, for repositories carrying history from before the schema existed.",
  },
  {
    id: "capability-contract",
    entry: "nodekit capability declare --capability <slug> --out <path>",
    gate: true,
    appliesTo: ["any"],
    offers: "Declare what a capability must measurably improve, and what result would make you delete it, BEFORE building it. `nodekit capability settle` scores the bet afterwards and refuses a contract that postdates its own measurement. A capability nothing user-facing can reach is decorative, which is a verdict rather than a warning.",
  },
  {
    id: "session-contract",
    entry: "nodekit sessions check --contract <session-contract.json>",
    gate: true,
    appliesTo: ["any"],
    offers: "Reject a multi-session plan that leaves any contended manifest unclassified, before launching agents that will all write it. Catches the ownership plan that is careful about the files the work is about and silent about the lockfile every session touches.",
  },
  {
    id: "regression-proof",
    entry: "nodekit regression prove --baseline <commit> --test <file>",
    gate: true,
    appliesTo: ["any"],
    offers: "Prove a regression test would actually have failed against the pre-fix code, by running today's tests in a worktree at the baseline commit. A test that passes on both sides is recorded UNPROVEN — from HEAD, a test that guards a bug and one that guards against it are both green.",
  },
  {
    id: "skill-freshness",
    entry: "nodekit preflight  (and `nodekit skills sync` to repair)",
    gate: false,
    appliesTo: ["any"],
    offers: "Report whether the coding-agent skills projected into this project still match the installed NodeKit, since those copies are what an agent actually loads and they freeze at create time. Reported rather than fatal: pinning or editing a projected skill is legitimate.",
  },
  {
    id: "code-graph-freshness",
    entry: "nodekit preflight",
    gate: false,
    appliesTo: ["any"],
    offers: "Report how far the commit-pinned code graph has drifted from HEAD, and how much of that drift was source. A stale call edge is indistinguishable from a live one at the point an agent uses it, so the drift has to be stated rather than discovered.",
  },
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
    entry: "@homenshum/nodekit build/story/launch evidence packs  ·  nodekit journey verify | build-evidence | story-pack",
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
    id: "replay-book",
    entry: "@homenshum/nodekit/replay-book",
    gate: true,
    appliesTo: ["any"],
    offers: "Generate PROMPT_BOOK.md and RECREATE.md from a replay packet instead of writing them. RECREATE leads with the reproduction rung actually earned and names the rungs it did not, so the document a person opens cannot claim more than the receipt behind it.",
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
    entry: "@homenshum/nodekit/agent-run  ·  nodekit agent run --agent <label> --goal <text>",
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
