# PROGRESS — Journey Harness and Codebase Tour

Agent-maintained handoff. **Re-read this first on every restart.** A fresh session has no memory of
the previous one, and a long session's history gets summarized. This file plus `git log` is the
durable record.

Harness pattern: `anthropics/cwc-long-running-agents` — default-FAIL contract, fresh-context
evaluator, agent-maintained handoff.

## The rule that governs this work

**The agent proposes; the agent does not approve.** Three independent sources agree on this and
they are the reason the work is shaped this way:

- NodeKit's own Evolution Ledger: material change requires a human-reviewed attestation.
- NodeKit PR #10: the evaluator must GENERATE evidence, never accept self-reported booleans.
- `cwc-long-running-agents`: "the agent can't claim success it hasn't observed."

So: every check in `harness/journey/journey-contract.json` starts **false** and may only flip on
observed evidence bound to a real artifact. Never hand-edit a check to true.

## Current objective

Close the two gaps that survived the 2026-07-24 codebase↔thread mapping:

1. **Codebase Tour** — genuinely missing (`START_HERE.md`, `GLOSSARY.md`, `repo-map.json`,
   `nodekit tour`).
2. **Language system** — genuinely missing (vocabulary map + copy audit); the only part of the
   proposed "Human Journey Harness" with no existing analog.

**Do NOT rebuild the Human Journey Harness.** It substantially exists already under other names:
`nodekit.interaction-flow/v1`, `nodekit.human-study-event/v1` (append-only, hash-chained, with the
friction taxonomy), `nodekit.builder-gym-verdict/v1` (baseline vs candidate trajectory, protected
evaluator, promotionAuthorized), `nodekit.fresh-user-study/v1`, `fresh-agent-verdict.v2`,
`canary-receipt`. Wrap and wire these; do not duplicate them. (This is the third time a proposal
turned out to be ~80% built — see App Atlas and NodeAgent Kit in the graph-hop ledger.)

## Status

| # | Step | State |
|---|------|-------|
| 0 | Cold-start baseline measured, friction recorded, nothing repaired | not started |
| 1 | `repo-map.json` generated from source + drift-checked | not started |
| 2 | `START_HERE.md` + `GLOSSARY.md` written from measured friction only | not started |
| 3 | `nodekit tour` executable walkthrough | not started |
| 4 | Vocabulary map + copy audit | not started |
| 5 | friction → gym → ledger wired as one path | not started |
| 6 | Tests + evolution attestation + PR | not started |

## Session log

<!-- Append one entry per meaningful checkpoint. Newest last. Keep entries short and factual. -->

- **2026-07-24 · session start** — Branch `feat/journey-harness-and-tour` off `main` @ 7a80b4a
  (ledger EVOLUTION PASS 14/14, PRs #9–#13 landed). Wrote this handoff and the default-FAIL
  contract before doing any repair work.

## Hard-won facts (do not re-derive)

- `nodekit doctor` and `nodekit demo` ALREADY EXIST in `src/cli.mjs`; only `tour` is missing.
- `AGENTS.md` is already the 14-line short-map form; it needs nothing.
- Recording an evolution event requires `interpretation.reviewedAt` — omitting it fails validation.
- After `evolution record` you MUST run `npm run evolution:docs` and commit
  `evolution/projections/`, or CI fails on the projection-drift step (separate from verify).
- Merge PRs with `--merge` (not squash) to keep `git:<sha>:` evidence bindings reachable.
- `proof/` has ~396 pre-existing dirty files that are NOT ours. Never stash/commit them blindly.
- The `smoke` CI job has a known flaky clipboard failure on macOS/Windows; `test` and `verify` are
  the authoritative gates.

- **2026-07-24 · tour + language shipped** — `ad0f153` harness+baseline, `8c16937` tour/repo-map/F5
  fix, `f87b46a` START_HERE/GLOSSARY/copy-audit. Contract at 8/12.
- **Process lesson (cost real time):** never chain `git stash` + `git checkout` + a long test run in
  one timeout-prone command. The timeout fired between checkout and `stash pop`, leaving the session
  on `main` with the work in `stash@{0}`. Nothing was lost, but recover with
  `git checkout <branch> && git stash pop` and do branch comparisons in a `git worktree` instead.
- **Full-suite reality:** local Windows run showed 5 failures. One was MINE (README links must
  resolve to packed package paths — fixed by packing START_HERE.md and GLOSSARY.md, which also
  means npm consumers get the glossary). The other four print Windows-style paths and main's CI is
  green on ubuntu, so they are almost certainly Windows-local. **CI is the authoritative gate — do
  not claim they are pre-existing without CI confirming.**

## Standing rule: every change ships before/after evidence

The owner had to ask for this, which means the practice was missing. It is not optional now.

A change is not reportable until there is an artifact showing its EFFECT, not its diff:
- **UI/template change** — render before and after side by side, both themes, same markup. If the
  change is supposed to be visually neutral, that identity IS the evidence; say so explicitly.
- **CLI/behaviour change** — capture real output from BOTH versions. Get the "before" by running
  the old commit (`git worktree add --detach <sha>`, or `git show <sha>:src/cli.mjs > tmp` and run
  it, since relative imports resolve against the current tree). Never quote the old output from
  memory or from notes — run it.
- **Always** state what the evidence does NOT prove.

Reason: NodeKit's own rule is that an evaluator generates evidence rather than accepting a claim,
and the long-running-agent harness rule is that the agent cannot claim success it has not observed.
Reporting a passing test as if it were an observed effect breaks both.
