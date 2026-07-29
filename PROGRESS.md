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

**Do not hand-maintain this.** A hand-written status table went stale within hours: it read
"not started" for seven steps that had already shipped, in the file whose own header says re-read
this first. State is derived now — ask the gate:

```bash
npm run journey:verify
```

It recomputes every check from evidence on disk and reports any claim it cannot derive, exiting
non-zero on an overclaim. As of 2026-07-25: **11 of 12 derive true, 0 overclaimed.** The twelfth,
`independently.evaluated`, is permanently underivable by design — nothing this repository computes
is independent review, and a checker able to grant it would launder the same self-approval one
layer deeper.


## 2026-07-26 — ONE COMMAND IS WAITING FOR THE OWNER

PR #20 (`feat/close-the-loop`, 18 commits) is pushed and cannot be merged by an agent. CI `verify`
blocks on:

    EVOLUTION MATERIALITY BLOCKED: 10 material files, 0 recorded events

That is correct. The branch changes `src/` and `schemas/`, the ledger requires a human-reviewed event
for material change, and this branch is what made such an event impossible to forge. An agent that
could satisfy this gate would be the bypass the branch removes, one layer out. `gh pr merge --admin`
would pass it and is not an option.

The draft is written and waiting at
`evolution/drafts/ledger-authority-and-immutability-enforced.json`, status `agent-proposed`:

```bash
nodekit trust init --reviewer homen --dev
nodekit evolution approve \
  --draft evolution/drafts/ledger-authority-and-immutability-enforced.json \
  --key ../.nodekit-dev-approval-dev-software-key.pem
nodekit evolution record \
  --file evolution/drafts/ledger-authority-and-immutability-enforced.json \
  --approval evolution/approval-ledger-authority-and-immutability-enforced.json
npm run evolution:docs && git add evolution/ && git commit && git push
```

`--dev` yields **H1** — an exportable software key, credential-attested only. It unblocks the merge;
it does NOT attest that a human was present, and `evolution verify` will keep saying
`authority.attested: 0 of 22` until a real H2 credential signs. That report is the point.

## Suite performance, measured rather than guessed

`node --test` runs ~31 files concurrently on a 32-core box, so wall-clock is set by the slowest file.

| finding | number |
|---|---|
| `agent-ease verdict binds all 15 trials` | **236s in one test** |
| every other test in that file | under 3s |
| the other 61 files | 390 tests, 539s CPU spread wide |
| `evaluate-agent-ease.mjs`, alone, timed end to end | **454s** on the real fixture |
| its fixture | 11,192 files — 5,415 PNGs, 5,567 JSONs |
| `nodekit --help` before / after | 708ms / **269ms** (bare node is 141ms) |

454 seconds for one invocation, walking ~11k files at roughly 40ms each. The test calls it several
times. That single file is the suite.

Four hypotheses for the cost were measured and **all four were wrong**: `npm pack` (2.4s x 6, real
but small), archive inspection (42ms), PNG validation (the probe called it with the wrong signature,
so its numbers meant nothing), and lock contention. The honest state is that the 454s is **located
but not explained** — it is spread across ~11k file operations rather than concentrated in one call.
`--cpu-prof` is the right next step; two attempts failed on the path trap below. **Do not guess a
fifth time.**

The open design question, which is the owner's: does a test asserting that *a verdict binds 15
trials to one packed candidate* need a complete 361-screenshot closure per trial? The binding is
what is under test; the screenshot volume is incidental to it. Shrinking the fixture would make this
fast, and would also weaken the completeness the protected evaluator exists to check. That trade is
a decision, not a refactor.

Two methodology traps that cost real time here:

- **Orphaned runs poison every measurement.** Timed-out `npm test` invocations left
  `evaluate-agent-ease` processes alive at 215s CPU each, saturating all 32 cores. Three separate
  suite runs stalled at exactly 14 tests because of it, and it read as a hang in the suite. Kill
  every `evaluate-agent-ease` / `--test` process and confirm zero before timing anything.
- **The Bash tool caps at 10 minutes and `&` does not survive it.** Detaching with `&` gets the
  child killed when the call returns. Use `run_in_background: true` for anything over ~8 minutes.
- **`$?` after a pipeline is the LAST command's status.** `timeout 25 node ... | head -5` reported
  `exit=0` and no output, which read as "it finished instantly". It had been killed at 25s. That
  produced a confident, wrong conclusion that the evaluator was fast. Capture the status before
  piping, or use `PIPESTATUS`.
- **`/tmp` is not the same path to bash and to node.** Bash writes to its own `/tmp`; node resolves
  `/tmp/x` to `D:\tmp\x`. Two `--cpu-prof-dir=/tmp/prof` runs wrote their profile somewhere neither
  tool then looked. Use absolute Windows paths when handing a path from bash to node.

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
