# Codebase tour, language system, and an error that teaches recovery

NodeKit could prove what an application did. It could not explain itself to the person who had to
work on it. The proof machinery was far ahead of the explanations.

## What was measured first

Phase 0 recorded friction and repaired nothing (`harness/journey/baseline-2026-07-24.json`). Seven
findings, three of them P0:

- **F1** `README.md` presented its first runnable command at line 35, but the dependency install
  step did not appear until line 79. The first documented action failed on a fresh clone.
- **F2** Eleven NodeKit-specific terms appeared in the first five lines of `README.md`
  (figured-out, conformance layer, proof-carrying, domain-blank, guided lifecycle, compiled
  definition, deterministic fixtures, browser proof, receipts, Convex-first, Convex-locked). None
  was defined anywhere. No glossary existed.
- **F5** `nodekit demo` from the platform repository exited 1 with "demo is not declared in
  nodekit.yaml". The refusal is correct, because lifecycle commands are declared per application.
  The message taught nothing and named no next step.

The baseline artifact records its own boundary: it is an instrumented probe run by a coding agent,
not a fresh-human study. It does not satisfy `nodekit.fresh-user-study/v1`.

## What changed

The undeclared-lifecycle error now names what the repository does declare and the two next steps,
and still exits 1. `nodekit repo map --write` derives `repo-map.json` from the CLI dispatch,
schemas, modules and package scripts. `nodekit tour` walks the orientation path and verifies each
step against disk; a step it cannot observe prints as a note with `passed: null` and is excluded
from the verified count. `nodekit copy audit` holds newcomer-facing copy to a vocabulary map and
blocks on a term the glossary does not define. `START_HERE.md` and `GLOSSARY.md` answer only what
the baseline actually recorded.

## What was deliberately NOT built

A proposal to add a "Human Journey Harness" was checked against the repository first. It was
already about eighty percent built under other names: `nodekit.interaction-flow/v1`,
`nodekit.human-study-event/v1` (append-only, hash-chained, carrying first-meaningful-action,
wrong-turn, help-request and p0-p1-failure), `nodekit.builder-gym-verdict/v1` (baseline against
candidate trajectory, protected evaluator, promotion authority), `nodekit.fresh-user-study/v1`,
`fresh-agent-verdict.v2` and `canary-receipt`. Nothing that duplicates those was added, and a guard
test now fails if a second owner of one of those concerns appears. This was the third proposal in
this repository's history to be mostly pre-built, so the guard encodes the lesson rather than
relying on someone remembering it.

## Evidence

`test/repo-tour.test.mjs` (5) and `test/copy-audit.test.mjs` (4) pass, 9 of 9. The adversarial cases
matter more than the happy paths:

- Against a repository missing the parts the map names, `nodekit tour` exits 1 and the failing step
  names the recovery. It cannot report a pass it did not observe.
- The copy audit must go red twice: once on jargon the glossary never defines, and once on jargon
  that is defined but never reachable because the page does not point at the glossary.
- A false-positive guard proves NodeKit terms inside code blocks, paths and link targets are not
  flagged. An audit that cries wolf gets switched off, and then it protects nothing.
- The repo-map drift assertion caught real staleness during this build, which is the behaviour it
  exists to produce.

`typecheck:public` exits 0.

## Known limitations

- The baseline is an automated probe, not a fresh-human study. It measures what the repository
  presents, not whether a person understood it. Five consented humans remain the real gate.
- The tour verifies four steps. Two steps are explanations and are labelled as such rather than
  being made falsely checkable.
- The copy audit covers three newcomer-facing surfaces. `docs/` (28 files) is not audited.
- Recorded friction cannot yet become a candidate repair judged by the Builder Gym. The parts exist
  but are not wired into one path.
- Nothing here certifies any application. `EASE_NOT_CERTIFIED` stands.
