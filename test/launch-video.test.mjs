import test from "node:test";
import assert from "node:assert/strict";
import {
  parseLaunchVideoContract,
  launchVideoTemplate,
  LaunchVideoRefusal,
  LAUNCH_VIDEO_SCHEMA_VERSION,
  COMPREHENSION_DIMENSIONS,
} from "../src/lib/launch-video.mjs";

// A filled contract that has legitimately reached each stage. Built by a founder persona walking
// the real journey: brief on Monday, direction approved Tuesday, two cuts, delivery Thursday for a
// Friday launch.
function directedContract() {
  return {
    schemaVersion: LAUNCH_VIDEO_SCHEMA_VERSION,
    application: "noderoom",
    declaredAt: "2026-08-03T09:00:00.000Z",
    brief: {
      product: "NodeRoom — live multiplayer rooms for agent runs",
      story: "watching an agent work should feel like watching a teammate, not tailing a log",
      audience: "engineering leads who have never seen an agent trace",
      launchDate: "2026-08-07",
      channels: ["linkedin", "x"],
    },
    direction: {
      singleMoment: "the second cursor appears and starts fixing the same file",
      beats: [
        { order: 1, job: "a lone developer stares at a failing suite" },
        { order: 2, job: "the room opens; the agent cursor arrives" },
        { order: 3, job: "the suite goes green while both cursors are visible" },
      ],
      references: [{
        url: "https://youtube.com/watch?v=example",
        facts: [{ at: "0:07", fact: "keycaps turn green on keypress; state change is the caption" }],
        whatToSteal: "state change carries the narration",
        whatNotToSteal: "logo sting before the product appears",
      }],
      durationTargetSeconds: 45,
      approval: { approvedBy: "homen", at: "2026-08-04T18:00:00.000Z" },
    },
    draftCycles: [],
  };
}

function comprehension(overrides = {}) {
  return Object.fromEntries(COMPREHENSION_DIMENSIONS.map((d) => [d, overrides[d] ?? 2]));
}

test("the template refuses as declared — an unfilled form is not a plan", () => {
  const template = launchVideoTemplate("noderoom", "2026-08-04T00:00:00.000Z");
  assert.throws(
    () => parseLaunchVideoContract(template),
    (error) => error instanceof LaunchVideoRefusal
      && error.refusals.some((r) => r.includes("template blanks not replaced")),
  );
});

test("an eager agent that rendered before direction was approved is refused at the stage exit", () => {
  const contract = directedContract();
  delete contract.direction.approval;
  contract.draftCycles = [{ cut: "out/cut-1.mp4", renderedAt: "2026-08-04T20:00:00.000Z" }];
  assert.throws(
    () => parseLaunchVideoContract(contract),
    (error) => error.refusals.some((r) => r.includes("direction.approval is missing")),
  );
});

test("a reference described with adjectives instead of timestamps is refused — taste must be scoreable", () => {
  const contract = directedContract();
  contract.direction.references[0].facts = [{ at: "great pacing", fact: "the pacing is good" }];
  assert.throws(
    () => parseLaunchVideoContract(contract),
    (error) => error.refusals.some((r) => r.includes("must be a timestamp")),
  );
});

test("the mom test blocks delivery alone, even when the other nine dimensions are perfect", () => {
  const contract = directedContract();
  contract.draftCycles = [{
    cut: "out/cut-3.mp4",
    renderedAt: "2026-08-05T20:00:00.000Z",
    judge: { craftVerdict: "publish", comprehension: comprehension({ non_expert_sense: 1 }) },
    disposition: "approve",
  }];
  contract.delivery = {
    finalCut: "out/cut-3.mp4",
    judgeReceipt: "out/cut-3.judge.json",
    deliveredAt: "2026-08-06T12:00:00.000Z",
    approval: { approvedBy: "homen", at: "2026-08-06T12:30:00.000Z" },
  };
  assert.throws(
    () => parseLaunchVideoContract(contract),
    (error) => error.refusals.some((r) => r.includes("mom test blocks delivery on its own")),
  );
});

test("a delivery dated after the launch is a retrospective, and refused as one", () => {
  const contract = directedContract();
  contract.draftCycles = [{
    cut: "out/cut-2.mp4",
    renderedAt: "2026-08-05T20:00:00.000Z",
    judge: { craftVerdict: "publish", comprehension: comprehension() },
    disposition: "approve",
  }];
  contract.delivery = {
    finalCut: "out/cut-2.mp4",
    judgeReceipt: "out/cut-2.judge.json",
    deliveredAt: "2026-08-09T12:00:00.000Z",
    approval: { approvedBy: "homen", at: "2026-08-09T12:30:00.000Z" },
  };
  assert.throws(
    () => parseLaunchVideoContract(contract),
    (error) => error.refusals.some((r) => r.includes("after brief.launchDate")),
  );
});

test("all-ones comprehension on the final cycle is a finding, not a middling pass", () => {
  const contract = directedContract();
  contract.draftCycles = [{
    cut: "out/cut-1.mp4",
    renderedAt: "2026-08-05T20:00:00.000Z",
    judge: { craftVerdict: "publish", comprehension: comprehension(Object.fromEntries(COMPREHENSION_DIMENSIONS.map((d) => [d, 1]))) },
  }];
  contract.delivery = {
    finalCut: "out/cut-1.mp4",
    judgeReceipt: "out/cut-1.judge.json",
    deliveredAt: "2026-08-06T12:00:00.000Z",
    approval: { approvedBy: "homen", at: "2026-08-06T12:30:00.000Z" },
  };
  assert.throws(
    () => parseLaunchVideoContract(contract),
    (error) => error.refusals.some((r) => r.includes("everything implied, nothing stated")),
  );
});

test("the honest journey passes at every stage: directed, revised with human notes, delivered before launch", () => {
  const contract = directedContract();
  assert.doesNotThrow(() => parseLaunchVideoContract(contract)); // stage 2: directed, no drafts yet

  contract.draftCycles = [
    {
      cut: "out/cut-1.mp4",
      renderedAt: "2026-08-05T09:00:00.000Z",
      judge: { craftVerdict: "recut", comprehension: comprehension({ purpose: 1, non_expert_sense: 1 }) },
      humanNotes: "the film opens on the terminal; open on the person",
      disposition: "recut",
    },
    {
      cut: "out/cut-2.mp4",
      renderedAt: "2026-08-05T20:00:00.000Z",
      judge: { craftVerdict: "publish", comprehension: comprehension() },
      humanNotes: "ship it",
      disposition: "approve",
    },
  ];
  assert.doesNotThrow(() => parseLaunchVideoContract(contract)); // stage 3: in revision

  contract.delivery = {
    finalCut: "out/cut-2.mp4",
    judgeReceipt: "out/cut-2.judge.json",
    deliveredAt: "2026-08-06T12:00:00.000Z",
    postCopy: ["posts/linkedin.md", "posts/x.md"],
    approval: { approvedBy: "homen", at: "2026-08-06T12:30:00.000Z" },
  };
  const parsed = parseLaunchVideoContract(contract); // stage 4: delivered, one day before launch
  assert.equal(parsed.delivery.finalCut, "out/cut-2.mp4");
});
