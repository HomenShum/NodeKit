import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  LEXICON_DIGEST,
  StoryPackRefusal,
  produceStoryPack,
  scanStatement,
} from "../src/lib/story-pack-producer.mjs";

// The scenario, held constant across every case below, because these defects only look like defects
// from inside it:
//
// Priya runs marketing for a salon-analytics product. The build finished on Friday. There is a
// BuildEvidencePack with two evidence entries, a demo seeded from a fixture, and a launch page due
// Monday. She is not dishonest. She is writing sentences that read well about software she watched
// work, and the fixture is three files away from the page she is writing.
//
// Every rejected sentence below is one a competent marketer writes without a flicker of doubt. That
// is the whole point: a checker that only catches sentences a liar would write catches nothing.
//
// Each withholding case keeps one good claim alongside the bad one, because content.claims has
// minItems 1 — a story where everything was withheld is not a story, and is tested separately.

const PACK = {
  schemaVersion: "nodekit.build-evidence-pack/v1",
  caseId: "salon-analytics",
  stage: "build",
  producedAt: "2026-08-01T10:00:00.000Z",
  content: {
    evidence: [
      { evidenceId: "ev-import-run", note: "CSV importer executed against a fixture export" },
      { evidenceId: "ev-chart-render", note: "revenue chart rendered in a headless browser" },
    ],
    claims: [{ claimId: "claim-import-works" }],
  },
  completeness: {
    notRun: ["no real merchant account was ever connected"],
    refused: ["refused to record a latency number nobody measured"],
  },
};

const SURFACES = [
  { surfaceId: "surface-landing", kind: "web-page", description: "Public launch page", route: "/" },
  { surfaceId: "surface-demo", kind: "web-page", description: "Interactive demo", route: "/demo" },
];

const AUDIENCE = {
  reader: "A salon owner who has never heard of this product",
  decision: "whether to connect their point-of-sale account",
  stakes: "prospective-user",
};

const DEMO_DISCLOSURE = {
  disclosureId: "disc-demo",
  kind: "demo-data",
  text: "This demo runs on sample data from a fictional salon. No account is connected.",
  placement: "adjacent-to-claim",
  surfaceRefs: ["surface-demo"],
};

/** The honest claim. Careful phrasing, real bindings — it survives every case below. */
const goodClaim = (over = {}) => ({
  claimId: "sc-import",
  statement: "The importer reads a point-of-sale export and renders a revenue chart.",
  surfaceRefs: ["surface-landing"],
  consequential: true,
  rendersData: true,
  buildBinding: { bepClaimIds: ["claim-import-works"], evidenceRefs: ["ev-import-run", "ev-chart-render"] },
  contentBinding: { origin: "fixture", sourceRefs: ["src-fixture-export"] },
  ...over,
});

const NARRATIVE = [{ order: 1, heading: "What it does", claimRefs: ["sc-import"], surfaceRef: "surface-landing" }];

// EXPLAIN binds the contract as well as the pack, so the narrative stays answerable to the
// successCondition somebody actually agreed to.
const CONTRACT = {
  schemaVersion: "nodekit.opportunity-contract/v1",
  user: "The owner of a one-location salon",
  problem: "Revenue lives in a point-of-sale export nobody opens",
  wedge: "Read the export they already have, without asking for a connector",
  primaryJob: "Turn a point-of-sale export into a revenue picture",
  inputs: ["pos_export_csv"],
  primaryArtifact: "A revenue chart",
  successCondition: "The owner sees last month's revenue without connecting an account",
  authorityLimits: { read: ["uploaded export"], propose: ["charts"], approve: [], prohibited: ["connect an account"] },
};

async function writeInputs({ pack = PACK, contract = CONTRACT } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), "storypack-"));
  const packPath = path.join(dir, "pack.json");
  const contractPath = path.join(dir, "contract.json");
  await writeFile(packPath, JSON.stringify(pack), "utf8");
  await writeFile(contractPath, JSON.stringify(contract), "utf8");
  return { packPath, contractPath };
}

const produce = async (over = {}) =>
  produceStoryPack({
    ...(await writeInputs()),
    audience: AUDIENCE,
    surfaces: SURFACES,
    narrative: NARRATIVE,
    now: "2026-08-03T00:00:00.000Z",
    ...over,
  });

test("a careful claim bound to real evidence survives and stays bound", async () => {
  const story = await produce({ claims: [goodClaim()] });

  assert.equal(story.content.claims.length, 1);
  assert.equal(story.content.claims[0].status, "bound");
  assert.equal(story.content.withheldClaims.length, 0);
  // Bound to a fixture, but the sentence never says whose data it is, so there is nothing to
  // disclose. Origin alone must not condemn a claim, or every honest demo gets blocked and the
  // check gets switched off within a week.
  assert.deepEqual(story.content.claims[0].dataImplications, []);
  assert.equal(story.stage, "explain");
  assert.equal(story.content.promotionAuthorized, false);
});

test("the sentence a marketer actually writes is withheld: it promises the reader's own data over a fixture", async () => {
  const story = await produce({
    claims: [
      goodClaim(),
      // Every reference resolves. The build really happened. The defect is the pronoun.
      goodClaim({
        claimId: "sc-your-revenue",
        statement: "See your revenue from your Square export, synced and up to date.",
      }),
    ],
  });

  assert.equal(story.content.claims.length, 1);
  assert.equal(story.content.withheldClaims.length, 1);
  const withheld = story.content.withheldClaims[0];
  assert.equal(withheld.claimId, "sc-your-revenue");
  assert.equal(withheld.withheldBecause, "cannot-be-disclosed-honestly");
  assert.deepEqual([...withheld.wouldHaveImplied].sort(), ["connected", "current", "factual", "user-owned"]);
  // Recorded, not deleted. A story that quietly dropped its weakest claim and one that never had it
  // must not look identical from outside.
  assert.ok(story.completeness.refused.some((entry) => entry.item.includes("sc-your-revenue")));
});

test("a demo-data disclosure on the claim's own surface makes it sayable, and the producer binds the disclosure to it", async () => {
  const story = await produce({
    disclosures: [DEMO_DISCLOSURE],
    claims: [
      goodClaim(),
      goodClaim({
        claimId: "sc-your-revenue",
        statement: "See your revenue from your Square export.",
        surfaceRefs: ["surface-demo"],
      }),
    ],
    demoMode: { engaged: true, surfaceRefs: ["surface-demo"], reason: "the product has no live connector yet" },
  });

  assert.equal(story.content.withheldClaims.length, 0);
  const claim = story.content.claims.find((entry) => entry.claimId === "sc-your-revenue");
  assert.equal(claim.status, "disclosed-demo");
  // The producer attaches the covering disclosure itself. A caller required to remember would forget.
  assert.deepEqual(claim.disclosureRefs, ["disc-demo"]);
});

test("a disclosure on a DIFFERENT surface does not cover the claim — the landing page reader never sees it", async () => {
  const story = await produce({
    // The disclosure sits on /demo. The claim below sits on the landing page.
    disclosures: [DEMO_DISCLOSURE],
    claims: [
      goodClaim(),
      goodClaim({
        claimId: "sc-your-revenue",
        statement: "See your revenue from your Square export.",
        surfaceRefs: ["surface-landing"],
      }),
    ],
  });

  assert.equal(story.content.claims.length, 1);
  assert.equal(story.content.withheldClaims[0].withheldBecause, "cannot-be-disclosed-honestly");
});

test("an evidence reference that resolves to nothing is withheld as invented, not warned about", async () => {
  const story = await produce({
    claims: [
      goodClaim(),
      goodClaim({
        claimId: "sc-latency",
        statement: "Reports build in under two seconds.",
        buildBinding: { bepClaimIds: [], evidenceRefs: ["ev-latency-benchmark"] },
      }),
    ],
  });

  assert.equal(story.content.claims.length, 1);
  assert.equal(story.content.withheldClaims.length, 1);
  assert.equal(story.content.withheldClaims[0].claimId, "sc-latency");
  assert.equal(story.content.withheldClaims[0].withheldBecause, "no-build-evidence");
});

test("a claim citing nothing at all is withheld; an empty binding reads as cited and cites nothing", async () => {
  const story = await produce({
    claims: [goodClaim(), goodClaim({ claimId: "sc-loved", statement: "Salon owners love it.", buildBinding: {} })],
  });

  assert.equal(story.content.withheldClaims[0].claimId, "sc-loved");
  assert.equal(story.content.withheldClaims[0].withheldBecause, "no-build-evidence");
});

test("a narrative beat left with no surviving claims is refused rather than shipped as an empty heading", async () => {
  await assert.rejects(
    produce({
      claims: [goodClaim(), goodClaim({ claimId: "sc-loved", statement: "Salon owners love it.", buildBinding: {} })],
      narrative: [
        ...NARRATIVE,
        { order: 2, heading: "Why owners switch", claimRefs: ["sc-loved"], surfaceRef: "surface-landing" },
      ],
    }),
    (error) => error instanceof StoryPackRefusal && /no surviving claims/.test(error.message),
  );
});

test("a beat that keeps at least one claim survives, and the loss is still recorded", async () => {
  const story = await produce({
    claims: [goodClaim(), goodClaim({ claimId: "sc-loved", statement: "Salon owners love it.", buildBinding: {} })],
    narrative: [
      { order: 1, heading: "What it does", claimRefs: ["sc-import", "sc-loved"], surfaceRef: "surface-landing" },
    ],
  });

  assert.deepEqual(story.content.narrative[0].claimRefs, ["sc-import"]);
  assert.ok(story.completeness.refused.some((entry) => entry.item.includes("lost sc-loved to withholding")));
});

test("when every claim is withheld the producer says there is no story, rather than emitting an empty one", async () => {
  await assert.rejects(
    produce({ claims: [goodClaim({ claimId: "sc-loved", statement: "Salon owners love it.", buildBinding: {} })] }),
    (error) => error instanceof StoryPackRefusal && /no story to tell yet/.test(error.message),
  );
});

test("a story that proposes nothing is refused, not emitted as a finished stage", async () => {
  await assert.rejects(
    produce({ claims: [] }),
    (error) => error instanceof StoryPackRefusal && /claims nothing explains nothing/.test(error.message),
  );
});

test("a claim rendered on a surface nobody declared is a caller bug, and refuses rather than withholds", async () => {
  await assert.rejects(
    produce({ claims: [goodClaim({ surfaceRefs: ["surface-pricing"] })] }),
    (error) => error instanceof StoryPackRefusal && /not in surfaces/.test(error.message),
  );
});

test("the build stage's own notRun and refused are inherited, so honesty does not reset per stage", async () => {
  const story = await produce({ claims: [goodClaim()] });

  assert.ok(story.completeness.notRun.some((entry) => entry.includes("no real merchant account was ever connected")));
  assert.ok(
    story.completeness.refused.some(
      (entry) => entry.item.includes("latency number nobody measured") && entry.reason.includes("inherited from the build stage"),
    ),
  );
});

test("the pack is bound by canonical digest, and the story never authorizes its own promotion", async () => {
  const story = await produce({ claims: [goodClaim()] });

  assert.match(story.inputs[0].sha256, /^[0-9a-f]{64}$/);
  assert.equal(story.inputs[0].caseId, "salon-analytics");
  // There is no caller-facing route to true. That is the design, not an omission in the test.
  assert.equal(story.content.promotionAuthorized, false);
});

// --- the scanner itself -------------------------------------------------------------------------

test("the scanner does not fire on a phrase buried inside another word", () => {
  // "live" inside "delivered", "actual" inside "actuality". A scanner that cries wolf gets disabled,
  // and then it protects nothing.
  const { implications } = scanStatement(
    "Reports are delivered with actuality nobody requested.",
    "2026-08-03T00:00:00.000Z",
  );
  assert.deepEqual(implications, []);
});

test("the longest matching phrase wins, so the finding points at what the writer wrote", () => {
  const { scan } = scanStatement("Built from your Square export.", "2026-08-03T00:00:00.000Z");
  const phrases = scan.matches.map((entry) => entry.phrase);
  assert.ok(phrases.includes("your square export"));
  assert.ok(!phrases.includes("your export"));
});

test("the scan records its own lexicon digest, so a later lexicon change is visible rather than silent", () => {
  const { scan } = scanStatement("your data", "2026-08-03T00:00:00.000Z");
  assert.equal(scan.lexiconDigest, LEXICON_DIGEST);
  assert.match(scan.lexiconDigest, /^[0-9a-f]{64}$/);
});
