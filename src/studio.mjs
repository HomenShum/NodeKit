// NodeKit Studio — the UI research, design, materialization and review surface.
//
// This is a BOUNDARY, not a relocation. Every capability re-exported here already shipped inside
// NodeKit under its own name; the thread that proposed "NodeKit Studio" named five components and
// all five already existed. What was missing was a declared edge: nothing said where Studio stops
// and the rest of NodeKit begins, so the standalone claim could not be tested and the A/B/C/D
// benchmark had nothing to point at.
//
// Extraction rule being followed deliberately: a standalone package INSIDE this repository, not a
// separate repository. A second repository before its consumers share one implementation boundary
// is a premature second platform. Extract only after NodeSlide, NodeVideo, the Verified Business
// Copilot and one external application all consume THIS surface.
//
// Files are not moved. Moving them would risk existing consumers for no gain, and the repository
// already has the pattern for this: `./caseflow` is a barrel over src/lib with a package export
// subpath. Studio follows that precedent.
//
// Division of labour, so the edge stays legible:
//   NodeKit  owns the builder journey — decide, build, explain, launch, learn.
//   Studio   owns the interface — find references, propose directions, build one, review, prove.
//   NodeProof owns whether the evidence is real. Studio does not grade its own output.

// --- Reference and pattern memory -------------------------------------------------------------
// Atlas stores what has already been proven: assets, interaction flows, recipes, anti-patterns.
// Studio reads it so a build reuses a proven surface instead of reinventing one.
export {
  ATLAS_EXPERIENCE_ASSET_SCHEMA,
  ATLAS_INTERACTION_FLOW_SCHEMA,
  addAtlasAsset,
  addAtlasFlow,
  initializeAtlasStore,
  inspectAtlasRecord,
  listAtlasRecords,
  readAtlasRecord,
  validateExperienceAssetDocument,
  validateInteractionFlowDocument,
} from "./lib/atlas.mjs";

// Progressive retrieval over that memory. Compaction is proven; the fielded ranker is NOT proven
// superior to a structured baseline and remains on probation — see the Atlas relevance benchmark.
export {
  atlasDelta,
  atlasPreview,
  atlasRecipe,
  atlasSearch,
  atlasValidateComposition,
} from "./lib/atlas-retrieval.mjs";

// --- Direction generation and comparison ------------------------------------------------------
// Three materially distinct directions, rendered, then compared by an independent critic. The
// contract the tournament builds against is PROTECTED: the coding agent may refine interpretive
// design, and may not re-decide the user, the job, the data authority or the permission boundary.
export {
  FRONTEND_EVALUATION_DIMENSIONS,
  FRONTEND_REQUIRED_GUARDRAILS,
  FRONTEND_REQUIRED_STATES,
  FRONTEND_REQUIRED_VIEWS,
  PRODUCT_DESIGN_CONTRACT_SCHEMA,
  compileFrontendPlan,
  createFrontendDirections,
  createFrontendRepairPlan,
  evaluateFrontendTournament,
  initializeFrontendHarness,
  verifyFrontendCanary,
} from "./lib/frontend-specialist.mjs";

// --- Proof that a direction actually renders ---------------------------------------------------
// The decisive verdict is computed from a verifier-authored render receipt and an independent
// review receipt. The evaluator GENERATES evidence; it never accepts a candidate's own booleans.
export {
  REQUIRED_RENDER_STATE_IDS,
  assembleFrontendRenderReceipt,
  directionSetHashOf,
  evaluateFrontendRenderContract,
  stateManifestHashOf,
} from "./lib/frontend-render-contract.mjs";

// --- The Decide -> Build seam ------------------------------------------------------------------
// Studio's input is an approved OpportunityContract compiled into a product design contract, so a
// Studio run cannot quietly re-scope the product it is dressing.
export { compileOpportunityToBuild, materializeBuildPacket } from "./lib/opportunity-compiler.mjs";

/**
 * The Studio loop, declared so the boundary is inspectable rather than described in prose.
 * `implemented: false` is load-bearing: `edit` has NO implementation in this repository, and
 * saying so here is the point of declaring the loop at all.
 */
export const STUDIO_LOOP = Object.freeze([
  Object.freeze({ step: "understand", implemented: true, surface: "compileOpportunityToBuild / compileFrontendPlan" }),
  Object.freeze({ step: "scan", implemented: true, surface: "atlasSearch / atlasPreview" }),
  Object.freeze({ step: "search", implemented: false, surface: null, gap: "No reference INGESTION. Atlas stores references and research-collector has generic providers, but nothing pulls an external design reference in." }),
  Object.freeze({ step: "direct", implemented: true, surface: "createFrontendDirections" }),
  Object.freeze({ step: "select", implemented: true, surface: "evaluateFrontendTournament" }),
  Object.freeze({ step: "build", implemented: true, surface: "coding agent against the protected product design contract" }),
  Object.freeze({ step: "edit", implemented: false, surface: null, gap: "No direct-edit capability exists. This is the largest genuine hole in Studio." }),
  Object.freeze({ step: "review", implemented: true, surface: "frontend review receipt / visual review inventory" }),
  Object.freeze({ step: "prove", implemented: true, surface: "evaluateFrontendRenderContract" }),
  Object.freeze({ step: "learn", implemented: true, surface: "Evolution Ledger + Builder Gym" }),
]);

/**
 * Report the Studio surface and, honestly, what it cannot yet do.
 * A boundary that only advertises its capabilities is marketing; this reports the gaps too.
 */
export function studioCapability() {
  const implemented = STUDIO_LOOP.filter((s) => s.implemented);
  const gaps = STUDIO_LOOP.filter((s) => !s.implemented);
  return {
    schemaVersion: "nodekit.studio-capability/v1",
    boundary: "packaged inside the NodeKit repository; not a separate repository until its consumers share this surface",
    steps: STUDIO_LOOP.length,
    implementedSteps: implemented.length,
    gaps: gaps.map((s) => ({ step: s.step, gap: s.gap })),
    standaloneReady: gaps.length === 0,
    notProven: [
      "The A/B/C/D benchmark (raw prompt vs contract vs contract+Atlas vs full Studio) has not been run, so no token or repair-round advantage is demonstrated.",
      "The frontend tournament has never been run end to end against a real generated application.",
      "The fielded Atlas ranker is not proven superior to a structured baseline.",
    ],
  };
}
