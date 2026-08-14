# Promotion Wave 3 — can a stranger maintain it

Date: 2026-08-13. Gate: [templates/promotion/HUMAN_READY.md](../templates/promotion/HUMAN_READY.md).
Follows [Wave 2](PROMOTION_WAVE2_RESULTS_2026-08-13.md).
Runs: 34 agents (reduce + cold read), then 34 more (repair + cold read again), then a
P0 pass. 2 agent errors, both cold readers lost to a connection drop and both re-run.

## What changed about the destination

The source thread added a fifth turn, and it moved the finish line. The end state is
no longer one condition but two:

> **REAL_USER_READY AND HUMAN_CODEBASE_READY** — "a real user can use the application
> confidently, and a new engineer can understand, modify, test, and explain the
> application without the original builder sitting beside them."

Wave 1 and 2 proved the first. Wave 3 exists to prove the second, and its final judge
is deliberately not us: a **cold reader** — a fresh agent session with no memory of
this work, given only the repository URL — asked to run the application and then trace
nine stages, naming a `file:line` for each.

## Result

| | iteration 1 | iteration 2 |
|---|---:|---:|
| HUMAN_CODEBASE_READY | 9 | **12** |
| READY_WITH_CAVEATS | 6 | **5** |
| lost to agent error | 2 | 0 |
| ran the application | 15/15 | **17/17** |
| answered all nine questions | 15/15 | 16/17 (one 8/9) |

At the close of iteration 2, sixteen repos carried the full packet on their default
branch and NodeSlide's sat in a pull request, because its main is protected. Both of
its pull requests have since merged, so the current count is **17 of 17** — see
"Final state" below, which is the number to trust if these two disagree.

## The finding that mattered most

**Five repositories independently shipped the same broken guard, in the same wave.**

Each one wrote an ordered walkthrough, and each one wrote a check to keep it honest.
Every check verified that the cited **line number was in range** and stopped there.
None verified that the line said what the citation claimed. What the cold readers
found that the guards could not:

- trialscope's walkthrough and tour both anchored *"the primary user action and the
  only one that starts a run"* to `web/components/thread.tsx:561` — which is the
  **edit** composer, `aui-edit-composer-root`. The real one is the `Composer`
  component at `:275`, submitting via `onSend` at `:286`. Verified independently. The
  guard passed because the line resolved uniquely.
- NodeKit's onboarding told the reader to master `advanceStage` in
  `src/lib/builder-journey.mjs` — a module reachable only from its own test, on no
  product path. The live rule is `decideProposal` in `src/lib/caseflow.mjs:327-338`.
  The tour step reported `[ ok ]` because `src/cli-main.mjs:896` checked only that the
  file existed.
- NodeGraph's `check-docs.mjs` tested `line > total`, so a twenty-line drift inside a
  six-hundred-line file passed silently.
- FeatureClipStudio's and agentic-ui-qa's guards had the same shape.

**A guard that proves only that a line number is in range proves anchor stability, not
anchor correctness — and a walkthrough's entire value is correctness.** It is worse
than no guard, because it earns trust it has not established. The rule is now in the
gate, and NodeRoom's `tests/walkthroughCitations.test.ts` shows the corrected shape:
it asserts the cited line contains the anchor it claims.

## What only a cold reader could find

Every one of these was a confident sentence that turned out to be false, or a
documented command that does not work. None was caught by a test.

- **NodeProof**: `npx proofloop` — used in ~30 README commands and nearly every
  package.json script — resolves the *published* package, not the clone, and fails
  silently. Every documented command was exercising code the reader was not looking at.
  **BetterPRHandoff** had the identical defect with `npx easier`, printed in 33 places.
- **NodeVoice**: `POST /compare/demo {"turns":3000000}` produced 3,000,000 steps and
  **1.6 GB RSS in 4.8 seconds** on a public route with `CORS *` and no body cap — while
  the repo's own live path already caps at 20MB. Separately, `{"target":"abc"}` reached
  a field typed `number`, making the room unable to ever complete.
- **NodeVoice** again: provenance reported `mode:'openai'` and the label
  "live · real reducer & scheduler" for runs whose model calls all failed and whose text
  was deterministic — violating the authors' own comment two lines above:
  *"Provenance must reflect what actually generated text, not what was requested."*
- **NodeTrace**: `scripts/capture-live-graph-rail.mjs:12` hardcodes port 5187 and shells
  `npm run dev` without `--strictPort`. On a machine already using that port, vite moves
  to 5188, the script screenshots **a foreign process**, and reports PASS with that
  process's entity counts. A proof that can prove the wrong application, silently.
- **NodeRoom**: the paragraph explicitly labelled "This is the trust boundary" said the
  agent is addressable *only* as `@nodeagent`; `src/ui/Chat.tsx:1166` accepts three
  prefixes (`@nodeagent`, `/ask`, `/free`). An incomplete enumeration in the worst
  possible place.
- **NodeMem**: a walkthrough claimed a test proved "the seven gates, one test per
  reason". Five were asserted; two were absent.
- **NodeRL**: the same trajectory reported two different total rewards on two surfaces
  — `npm run demo` printed 0.238 while the storybook badged 0.171.

## Reduction can go too far, and CI caught it

NodeSlide's reduction removed `convex`, `katex`, `pptxgenjs` and `@types/katex` from
`mcp/package.json` on Knip's report that they were unused. But `mcp/tsconfig.json` sets
`baseUrl: ".."` and typechecks files outside its own workspace —
`packages/cli/src/generate.ts` imports `convex/browser` and `convex/server`,
`slidelang/mathRaster.ts` imports `katex`, `pptx.ts` imports `pptxgenjs`. Five TS2307s.

**Unused within a workspace is not the same as unused, when the workspace compiles code
from outside itself.** Restored in `2997f42`. Worth recording as a standing caution
about automated unused-code reports.

## Remaining caveats

- **NodeBenchAI** — stages 3–8 live server-side in Convex and the repo ships no local or
  fixture backend, so a third-party cloud account is required to observe a single answer
  stream. Traceable and unit-tested, not observable. A fixture backend is the named next
  feature, not a defect.
- **trialscope** — the documented test command fails from a clean clone, and three
  documents give three different suite sizes (README 1270 *and* 451, CLAUDE.md 1246;
  the truth is 1270). In a repo whose standing rule is measure-then-claim.
- **NodeSlide** — the README's headline deterministic-path promise is still false on
  main until the pull requests land.
- **NodeTrace**, **FeatureClipStudio** — see the P0 list above; both in flight.

## The guard caught the repo that wrote it, on its first run

NodeSlide's Wave 3 work sat in a pull request because its main is protected. Its
iteration-2 fix — which added the corrected citation guard — merged first. That guard
then ran against NodeSlide's *own* Wave 3 branch and failed it: **thirteen `file:line`
citations naming no symbol**, two of them citing a bare `NodeSlideStudio.tsx` that does
not resolve from the repository root at all.

The branch that wrote the walkthrough could not tell its citations were unverifiable.
The check written afterwards could, immediately. Every one now names a symbol verified
present on the cited line or range — checked with an independent reimplementation of
the guard rather than by trusting the edit. Landed in `6027823`.

One self-inflicted failure worth recording: restoring the four dependencies reformatted
two `package.json` files with `JSON.stringify`, which expands short arrays that biome
collapses (`"files": ["dist"]`). Caught by the lint job, fixed with the repo's pinned
biome 1.9.4. A formatter is a guard too.

## Final state, verified 2026-08-13

Measured through the authenticated GitHub API, not from any agent's report:

- **17 of 17** repositories carry the complete packet on their default branch:
  `docs/START_HERE.md` (14–23KB), `docs/SIMPLIFICATION_REPORT.md`, exactly seven files
  in `docs/codebase/`, and 2–4 validated tours.
- **65 of 204** promotion conditions PASS, each with a committed artifact and a
  committed producer. The path there: 54 claimed → 40 judge-confirmed → 38 standing
  after correction → 61 after Wave 2 → 65 after Wave 3.
- Every conformance gate in the portfolio runs and passes.
- 12 repositories are HUMAN_CODEBASE_READY by a cold reader who was given nothing but
  the repository URL.

## The honest summary

Wave 3's own documentation was wrong in specific, checkable ways, and the wave's own
guards could not see it. That is the finding, not an embarrassment: it is exactly what
the thread predicted when it said *"the strongest gate is not the same coding agent
declaring that its own work is understandable."* Twelve repositories now pass a test
that no one who built them administered.

## The P0 pass, and what adversarial verification is actually worth

The cold readers surfaced four P0-class defects that no test caught. Fixing them took
two rounds, because the first round's verifiers refused to pass work that did not hold
up under re-measurement.

**Closed and independently re-measured:**

- **NodeVoice** — a public `CORS *` route accepted `{"turns":3000000}` and peaked at
  **2,884 MB RSS** before returning HTTP 500. Now bounded. `{"target":"abc"}` reached a
  field typed `number`; now narrowed on both routes. Provenance reported
  `mode:"openai"` and "live" for runs whose model calls all failed; it now reports
  `mode:"deterministic"` with a fallback count. The bare `catch { return deterministic }`
  now logs and fires a callback while keeping the fallback.
- **NodeTrace** — the capture script could screenshot a *foreign process* on a busy port
  and print PASS with that process's numbers. Closed at a shared seam all three capture
  callers route through, with an identity regression probe the verifier defeated-tested
  by reverting the script and watching it fail.
- **trialscope** — five items, no regressions.
- **FeatureClipStudio** — the misleading `ENOENT` now names Windows MAX_PATH.

**What the verifiers caught that the fixes claimed were done:**

- FeatureClipStudio said eight callers routed through its new handler. There were
  **nine** — `iterate.mjs:66`, the documented stage-5 gate, bypassed it entirely. Worse,
  the guard meant to prove the wiring was decorative: reverting a CI step to the
  bypassing shape still printed PASS, because a **comment** two lines above contained
  the string it grepped for. And the fix introduced its own defect —
  `spawnSync(…, {shell:true})` with no quoting silently wrote `out/my.mp4` for
  `"out/my clip.mp4"` and exited 0.
- NodeVoice's body cap traded one defect for another: a client crossing the cap then
  going silent was dropped in **49 ms** before, and held for **300 s** after.

Both were repaired. FeatureClipStudio's guard now *discovers* callers instead of
consulting a list — a five-mutation battery reverting each caller in turn is caught,
each named by `file:line` — and the quoting fix reuses an expression the repo already
owned rather than inventing a second one.

**What survived even the repair round:** NodeVoice's seam is still not closed.
`convex/http.ts` is a **second complete implementation of the same public API** —
registering POST `/compare/demo`, `/nodeagents/run` and `/live/rooms` — reading every
body with `req.json()`, so the Node-side cap does not protect it. The anti-enumeration
guard could not see it because it walked `src/` only. That is in flight.

**The lesson worth keeping:** every one of these was found by re-running a measurement,
never by reading a diff. Three separate guards in this wave — a citation checker, a
wiring probe, and an anti-enumeration test — passed while the thing they guarded was
broken, each because the guard checked a proxy (a line number, a substring, a
directory) instead of the property. A guard is only worth what it fails on.

## Standing caution: a second implementation is the bypass you will miss

Two repositories in this wave had the same shape — a fix applied at "the" seam, with a
second complete implementation of the same surface elsewhere in the tree. NodeSlide's
mcp workspace compiled code from outside itself; NodeVoice serves its public API twice.
Before declaring a seam closed, search for a *second* implementation of the surface, not
just other callers of the one you found.
