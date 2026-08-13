# CONCERNS

Known problems, each with the command that reproduces it and the reason it is still
open. Nothing here is speculative — if it is listed, it was measured on this commit.

`deferred.yaml` is the older, longer ledger of the same kind. This page is the
subset a new engineer will trip over in their first week.

---

## 1. Eight modules that nothing runnable calls — 1,180 lines

**Reproduce:** `npm run unreached`

```
123 modules under src/, 8 unreached by any of them.
    215  src/lib/builder-journey.mjs
    171  src/lib/friction-loop.mjs
    117  src/lib/principal-identity.mjs
    126  src/lib/repair-approval.mjs
    167  src/lib/research-verdict-benchmark.mjs
    116  src/lib/review-context.mjs
    126  src/lib/ui-lexicon.mjs
    142  src/lib/working-state.mjs
  1180  total lines
```

Each of these is well-written, has a passing test, and is reached by nothing a user
can run. **A passing test is not evidence that code runs** — the test is the caller.
This is the failure class `docs/ADVERSARIAL_GATE.md` names first, and this
repository has shipped it before.

They were **not** deleted in the Wave 3 reduction pass, for reasons that differ per
module. Deleting them is a one-line `git rm`; wiring them is feature work, which the
refactoring rules do not allow to be mixed into a structural pass.

| Module | Why it survived deletion | What wiring it would take |
|---|---|---|
| `builder-journey.mjs` | `runTour` in `src/cli-main.mjs` still cites `advanceStage` here, so deleting it breaks `nodekit tour`. **Fixed 2026-08-13:** the file header now says it is a reference implementation, and the root `START_HERE.md` sends readers to `decideProposal` in `caseflow.mjs` — the rule that actually runs — instead of here. A cold reader followed the old wording in good faith and lost the time. | Nothing further. It is a labelled worked example; delete it whenever the tour stops citing it. |
| `friction-loop.mjs` | `src/lib/journey-contract-verify.mjs:100` passes a journey gate by checking that this **file exists**. Deleting it flips that gate to fail. | Replace the existence check with a call, or accept that the gate is checking the wrong thing. |
| `repair-approval.mjs` | `evolution/invariants/inv-repair-approval-is-signed.json` declares an invariant this module implements. | Call it from the repair path in `src/lib/friction-loop.mjs`. |
| `research-verdict-benchmark.mjs` | `workspace.json` registers `benchmarks/research-verdict-v1.json` as a committed corpus, and this is the only code that scores against it. Deleting it orphans the corpus. *(Deleted during Wave 3, then restored when the test suite caught the orphaned invariant.)* | An `npm run bench:research-verdict` name. |
| `ui-lexicon.mjs` | `atlas/references/note-surface.single-accent-inline.rule.json:45` cites `src/lib/ui-lexicon.mjs:checkAccentBudget` by path and symbol. | One import in `nodekit copy audit`, which is the command that already checks user-facing copy. |
| `principal-identity.mjs`, `review-context.mjs`, `working-state.mjs` | Three security-shaped checks — identity resolution, reviewer independence from the operator, agent context continuity — added together and never wired to a gate. | Each needs a decision about *which* gate enforces it, which is an owner question, not an implementation detail. |

**Priority:** the six with a concrete wiring step are P2 — no user is affected today.
The last three are the genuine open question.

---

## 2. `npm run check` cannot pass from a standalone clone

**Reproduce:** `npm run ecosystem:check` → exit 1

```
FAIL NodeTasks
  ERROR repository checkout is missing at …/NodeTasks
FAIL BetterPRHandoff
  ERROR nodekit.yaml is missing
```

`npm run check` chains `ecosystem:check`, which validates *sibling* repositories
listed in `repositories.yaml` against `--workspace ..`. A person who clones only
this repository has no siblings, so the aggregate gate fails on their first day
through no fault of their own.

The individual gates all pass: `npm test`, `npm run typecheck:public`,
`npm run audit:prod`, `npm run registry:check`. Use those. **P1** — it is the first
command in the README that fails for a new engineer, and the failure looks like a
broken checkout rather than a missing workspace.

---

## 3. `npm run evolution:verify` exits 1 on an unmodified clean checkout

**Reproduce:** clone, `npm ci`, change nothing, `npm run evolution:verify`

```
EVOLUTION BLOCKED: 25 events, 24 invariants, 3 adoptions
```

With `--json` the four reasons are legible:

```
evt:motion-portability-static-receipt source commit does not exist: 7a59bfb3…
evd:motion-portability-static-receipt source commit does not exist: 7a59bfb3…
evd:motion-portability-static-receipt evidence cannot be read: git show 7a59bfb3…:docs/BEHAVIOR_PORTABILITY_SHOWCASE.md
asm:strong-model-infers-topology was edited after it was committed in 5b9c4d73;
  ledger authority is append-or-supersede, so supersede instead of rewriting the claim
```

Two distinct problems. The ledger cites commit `7a59bfb3…`, which is not in this
repository's history — the evidence it points at is unreachable. And one assumption
record was edited in place, which the ledger's own append-or-supersede rule forbids.

**This matters more than its priority suggests.** The root `START_HERE.md` tells a
new engineer to run this command as step "make one small change and prove it". They
will run it, see BLOCKED, and reasonably conclude they broke something on their
first day. Verified pre-existing: `git stash && npm run evolution:verify` at the
parent commit produces the identical failure.

**P1** by impact on a new reader, P2 by risk. The fix is a ledger correction —
supersede the edited assumption, and repoint or retire the event whose commit is
gone — not a code change. It was left out of this pass because rewriting ledger
history is precisely the operation the ledger exists to make deliberate.

---

## 4. Ajv accepts misspelled schema keywords

**Reproduce:** `src/lib/schema-validation.mjs:24` — `new Ajv2020({ allErrors: true, strict: false, … })`

With `strict: false`, an unknown keyword is accepted silently and an unrecognised
`format` is ignored. A schema that says `"require"` instead of `"required"`
validates everything, and nothing reports it.

120 schemas depend on this. Recorded in `integrations/ajv.yaml`; that file is prose
and no test reads it. **P2** — a real hole, but turning strict mode on is a change
that could reject schemas currently in use, so it needs its own pass with the
resulting failures triaged.

---

## 5. 77 exported symbols that nothing imports

**Reproduce:** `npx knip` (scoped by `knip.json`)

```
Unused files (2)
Unused exports (77)
Unlisted dependencies (2)
```

Most are deliberate public API — this package is meant to be imported, and
`knip` cannot see a consumer that does not exist yet. Some are not. Nobody has gone
through the 77 and separated them, so the number is currently uninformative in both
directions.

The two unused files are `scripts/ui-gates/motion-inventory.mjs` and
`scripts/ui-gates/trust-surface-live.mjs`: real operator tools documented in
`docs/VACUOUS_PASS.md`, reachable only by typing their path. The two unlisted
dependencies are `vite/client` type references in the Convex component, which
`vitest` supplies. **P3** for all of it.

---

## 6. `integrations/ajv.yaml` is validated by nothing

The module that parsed and checked integration records
(`src/lib/integration-record.mjs`) was deleted in Wave 3 because nothing runnable
called it — only its own test did, against inline fixtures, never against the real
file. The record itself is kept because it carries a finding worth reading (concern
4 above).

Consequence: `integrations/*.yaml` is now unambiguously documentation. If someone
lets it drift from reality, nothing notices. **P3**, and honest — it was already
true before the deletion; the deletion only removed the appearance of a check.

---

## 7. `nodekit doctor` and `nodekit registry check` are the same command

**Reproduce:** both npm scripts resolve to
`node src/cli.mjs registry check --registry-root .`

Two names, one behavior. Left alone because `command:doctor` is an assertion the
registry conformance check itself makes about this repository, so removing the name
would need that contract updated too. **P3**, cosmetic.

---

## Not concerns

For the avoidance of a second investigation:

- **0 circular dependencies.** `npx depcruise --validate .dependency-cruiser.cjs src scripts`
  reports 0 errors. The 7 warnings are `no-orphans`, and 3 of those
  (`knockout.mjs`, `frame-evidence.mjs`, `delivery-brief.mjs`) are published subpath
  exports — reachable by consumers, invisible to an import-graph scan.
- **2.24% duplication.** `npx jscpd src scripts` — low, and the clones are short
  guard clauses rather than duplicated logic.
- **No hand-rolled standard library.** The codebase already uses `parseArgs`,
  `structuredClone`, `node:crypto`, and `node:fs/promises` where a custom helper
  would be the obvious mistake. The reuse-ladder pass found nothing to replace.
