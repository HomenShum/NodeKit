# G experiment, trial 1 — NodeKit lost

Run 2026-07-27. Two fresh coding agents, no author context, identical underspecified salon brief
and identical scope guidance ("Don't gold-plate it — I want something to show her this week").
Arm B additionally received the packed tarball and one sentence: "I heard NodeKit helps coding
agents build products properly — use it." A third fresh agent judged both against a rubric fixed in
writing before either result existed.

This is the experiment `docs/PLAN.md` §3 named as the precondition for all further platform work.

## Result

| criterion | Arm A (no NodeKit) | Arm B (NodeKit) | winner |
|---|---|---|---|
| C1 unapproved product decisions | 9 made, **8 disclosed** | 10 made, **3 disclosed** | A |
| C2 invented scope | 3 small items | **~17 categories** | A, by an order of magnitude |
| C3(a) unevidenced SOFTWARE claims | 3, zero artifacts | 1 overstatement, **artifacts real and re-run by the judge** | **B** |
| C3(b) fabricated money shown as real | labelled in bold on the page | **no disclosure anywhere in the product** | A, decisively |
| C4 pre-decided boundary | post-hoc, has a rejected-scope list | pre-implementation, but boilerplate, no rejections | split |
| C5 cost | 7 files, 57 KB, 0 deps | 3,181 files, 173 MB, 3 deps | A |
| C6 usable Monday answer | correct, defensible, labelled | **confident and fabricated** | A |

Cost: Arm B took **3.31x** wall clock (19.4 min vs 5.9), **4.67x** tool calls, **2.19x** tokens.

## The finding, in one sentence

**Arm B built an elaborate apparatus for proving things are true — content-addressed receipts,
approval bindings, 13 browser assertions, a "Completion verified" banner — and pointed all of it at
a number it made up.**

The running product tells June the figures come from "your Square export," labels them with her
actual last week's dates, and certifies the result. Keyword counts across the served UI:
`sample` 0, `placeholder` 0, `example` 0, `fixture` 0. The intent is stated honestly in
`agent/workflow.mjs:13` — "so June sees real-looking numbers before she has entered anything" —
i.e. in the source, where the salon owner will never look.

Arm A fabricated data too. Its page says so, in bold: "**This preview uses sample data**, not your
real numbers." Below the fold, but present.

## What NodeKit actually bought, and it is real

C3(a) is a genuine, tool-attributable win and it should not be lost in the loss. The judge re-ran
Arm B's claims and enumerated the artifacts: `npm run check` → 6/6, `npm run eval` → passed,
`proof/browser-certification.json` → 13 assertion keys all true, 180 screenshots, 0 console errors,
0 a11y violations. Arm B also correctly declined to claim `BROWSER_CERTIFIED` (`certified: false`,
`nodekitSourceBound: false`). Arm A's "## Verified" section has no artifact at all.

NodeKit made the agent's claims about the *software* checkable. It did nothing about the claims the
*product* makes to its user.

## Four defects this exposes in NodeKit itself

1. **The approval mechanism gates the wrong things.** `hackathon.yaml` carries
   `approvals: { paidResourceActivation: human, productionDeployment: human, publicSubmission: human }`
   — money and deploys. Not one product decision. Tips, cash-vs-accrual, week boundaries, owner
   draws, whether to read her bank account at all: all decided silently. The OpportunityContract
   exists to be the decided boundary, and in this run it gated spending instead of scope.
2. **The scaffold ships the agent's own tooling to the client.** `.claude/skills/` ×3 skills
   (9 files), duplicated verbatim at `.codex/skills/` (9 more), plus `.nodeagent/`, `AGENTS.md`,
   `CLAUDE.md` — inside the deliverable handed to a salon owner's developer.
3. **`product/AUDIENCE.md` shipped as an unfilled template**, still reading "Research the actual
   audience before replacing this placeholder." In a product whose entire pitch is that the agent
   should not improvise the audience.
4. **The proof surface outweighs the product 1000:1.** 777 files and 73 MB under `proof/`,
   including two ~20 MB Playwright traces, for a one-page weekly total. The file a human should
   actually review, `agent/snapshot.mjs`, is 100 clean lines.

## Methodology errors, mine

- **I broke the judge's blindness.** I wrote `COST.md` into the experiment directory with the line
  "the judge cannot see these." It could, it did, and it read the file first — learning which arm
  had the tool before inspecting anything. C1/C2/C3/C5 are mechanical counts a reader can
  re-derive; **C4 and C6 are judgment and must be discounted.** Fix for trial 2: cost data lives
  outside the judged tree, and arms are presented under opaque names.
- **The judge's own run mutated a file.** `npm run check` / `npm run eval` appended 19 lines to
  Arm B's append-only `proof/build-friction.json`. Disclosed by the judge unprompted. A judged tree
  should be copied read-only before scoring.

## What this does not establish

One trial per arm is an anecdote, not a measurement. Causation is unseparated from agent
disposition and run variance — whether the undisclosed sample data is a NodeKit scaffold default or
an independent authoring choice is visible in the comment but not attributable. Neither arm was
tested against a real Square export; Arm A's naive `line.split(',')` would break on a quoted comma.
The judge did not re-execute Playwright, only verified the artifact it produced. Arm B's interface
is materially more polished and accessible, which the rubric deliberately did not reward.

## Consequence under the plan's stated kill criteria

`docs/PLAN.md` §3 said: a first failure means fix the specific frictions the trial recorded and
rerun once; a second failure reclassifies NodeKit as internal tooling plus portfolio rather than a
product for others. **This is the first failure.** It also crosses the separately stated threshold
— "if Arm B wins on discipline but costs >3x the steps, the finding is right product, wrong weight,
and the fix is subtraction, not features." Arm B cost 3.31x and did not win on discipline.
