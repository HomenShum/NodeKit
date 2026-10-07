# Promotion Wave 2 — one defect each, re-proved

Date: 2026-08-13. Follows [PROMOTION_WAVE1_RESULTS_2026-08-13.md](PROMOTION_WAVE1_RESULTS_2026-08-13.md).
Gate: [templates/promotion/GATE.md](../templates/promotion/GATE.md).
Runs: 26 agents (13 fixes, each with its own adversarial verifier), then 6 more
(3 sibling fixes + verifiers). 0 errors.

## Result

**13 of 13 defects confirmed gone**, each re-proved in the rendered application by
an independent verifier that re-ran the original reproduction rather than reading
the report. Every fix committed both halves of its evidence — the output and a
producer that regenerates it from a fresh clone. Zero REFUTED.

Portfolio standing: **38 → 61 of 204** conditions, verified by re-tallying the
scorecard each repo actually serves. Every repo's table count matches its own
trailing status line.

| repo | before | after | defect closed |
|------|-------:|------:|---------------|
| NodeRoom | 4 | 5 | receipt journey (J3) |
| NodeBenchAI | 0 | 1 | every route showed "Convex backend not configured" from a clean clone |
| NodeAgent | 3 | 7 | app blanked at every width ≤ 960px once the agent's first loop step ran |
| trialscope | 2 | 3 | the registry-wide warning was computed and discarded before the reader |
| NodeVoice | 5 | 6 | the demo carrying the headline claim could never reach 100 |
| NodeGraph | 2 | 3 | trust-grammar violation: assertion and traversal edges were not distinguishable |
| NodeKit | 6 | 8 | the page argued with itself after Reject |
| NodeProof | 1 | 6 | the repo could not prove its own page |
| NodeTrace | 0 | 1 | the installer shipped a Next target that could not build |
| NodeMem | 3 | 5 | blank frame with confident prose and no recovery when a CDN was blocked |
| FeatureClipStudio | 0 | 1 | every clip opened on a flash of the letterbox backdrop |
| agentic-ui-qa | 4 | 5 | the demo surface was an HTML fragment, not a document |
| NodeSEO | 2 | 4 | the journey's only quality gate could not fail |

## The three siblings, and why they mattered

Three verifiers set `fix_is_root_cause: false` — not because the fix was cosmetic,
but because each named a specific sibling one level deeper. All three were then
closed and re-verified.

**NodeKit was the serious one.** Iteration 1 made the *rejected* path derive its
presentation from the achieved result. The *accepted* half of the same `if/else`
still keyed on the decision **requested**, discarding the return value. A live
probe: POST a conflict scenario, then accept — **HTTP 200 with "Completion
verified — The canonical artifact and content-addressed receipt are ready", while
`proposal.status='conflicted'` and `receipt=null`.** A false success claim, which
is worse than the over-demanding defect already fixed. The true root cause was one
level below where iteration 1 stopped: *presentation derived from the decision
requested rather than the result achieved.* Fixed at the single seam
(`applyDecision`); all fifteen scenario states diff identical before and after,
and the replaced assertion had literally required the buggy shape
(`assert.ok(server.indexOf('input.decision === "accepted"') >= 0)`) — it could
only have held while the defect held.

**agentic-ui-qa** had a third copy of the authoring directive 120 lines below the
one fixed, scoped more broadly ("at every tier"), which would have re-authored the
same fragment. Worse: the guard had no teeth — deleting the fix left
`npm run doctor` and `npm run proof` green at 13/13. Now the same deletion turns
them red, proven in both directions.

**NodeSEO** still filtered first-party console errors by *word*: a
`console.error("favicon pipeline exploded")` served from `127.0.0.1` passed the
gate. Fixed by deleting the text filter entirely — a pure removal, strictly
stricter, verified with a probe sharing no code with the repo's own producer.

## The CI finding, which no agent was looking for

Checking whether Wave 2 broke anything, five repos showed red CI. **Every one was
already red at the parent commit** — Wave 2 broke nothing. But the cause split in
two, and one half was worse than a failure.

NodeRoom, NodeAgent and NodeVoice reported a *path-named* run with **`jobs=0`**:
the workflow never started. Their conformance workflow said
`uses: HomenShum/node-platform/...@<sha>` while the working repos said
`uses: HomenShum/NodeKit/...@<sha>`. The pinned SHA was valid in both cases —
`5c9aa64` resolves fine in NodeKit. The difference was purely the repository name:
**`actions/checkout` follows a rename redirect; reusable-workflow `uses:`
resolution does not.**

So since the node-platform → NodeKit rename, three repos have had a conformance
check that reported nothing at all. A gate that never runs is worse than one that
fails, because it still occupies the slot where a signal should be.

Fixed (NodeRoom `5de0508`, NodeAgent `19b38d7`, NodeVoice `cff4e4d`): the runs now
resolve by name, create `jobs=1`, and **conclude success** — verified by watching
them to completion, not by pushing and assuming.

**Still open:** NodeMem and NodeTrace fail the contract check for a real reason,
reproduced locally: `ERROR consumes omits registered concept
nodeagent.event-protocol`. Everything else in their contract passes. Either the
registry entry is wrong or their `nodekit.yaml` is — that needs a decision about
whether those repos genuinely consume NodeAgent's event protocol, which is why it
was not guessed at here. Both are blocked on condition 11 until it is settled.

## Caveats the verifiers logged and no one hid

- **NodeKit**: `/api/resolve-conflict` returns a receipt-backed completion while
  `proposal.status` stays `conflicted` — not a false claim, but the producer's
  `completionIsReal()` is false on that state and never probes that route. One
  structurally similar branch survives in `loadScenario`, currently unreachable.
- **agentic-ui-qa**: the new proof script is itself only `node --check`ed — the
  guard is wired, the guard-of-the-guard is not. Its receipt also under-reports,
  truncating to the last four stderr lines when rendered mode names five failures.
- **NodeSEO**: removing the favicon pattern means a real site whose own favicon
  404s now turns the journey red. Arguably correct for an SEO tool, but nothing in
  the repo exercises it.

## What Wave 3 owes

1. Settle the `nodeagent.event-protocol` registry question for NodeMem and NodeTrace.
2. Close the three caveats above.
3. Conditions 7 and 8 remain unmeasured almost portfolio-wide: the Web Interface
   Guidelines reviewer and the Lighthouse/web-quality toolchain named in
   `SKILLS.md` are not installed here. No repo laundered an ad-hoc observation into
   a review it did not run, which is the gate working — but the toolchain has to be
   installed before those 34 conditions can move.
4. NodeSlide still needs [PR #181](https://github.com/HomenShum/NodeSlide/pull/181)
   merged; NodeRL, NodeAgentSpec and BetterPRHandoff still await the merge-or-retire
   and marketplace decisions.
