# SIMPLIFICATION REPORT — Wave 3 (HUMAN-READY)

Every row was produced by running the command in the last column, once before any
change and once after. Where a tool does not fit this stack the row says so instead
of being left blank.

**Headline, stated plainly so nobody has to infer it from the table:** this
codebase was already tight. The reduction pass removed 4 production files and about
1,000 lines, and found **nothing** to replace with a standard-library or platform
capability. The largest finding is not something that was deleted — it is 1,180
lines across eight modules that nothing runnable calls, which are recorded rather
than removed, and the reason per module is in `docs/codebase/CONCERNS.md`.

## The table

| Measure | Before | After | Change | Evidence command |
|---|---:|---:|---:|---|
| Production files | 211 | 207 | −4 | `git ls-files src scripts \| grep -vE '\.test\.' \| wc -l` |
| Production source lines | 58,760 | 57,814 | −946 | `git ls-files src scripts \| grep -vE '\.test\.' \| xargs wc -l \| tail -1` |
| Direct dependencies (prod) | 4 | 4 | 0 | `node -e "console.log(Object.keys(require('./package.json').dependencies).length)"` |
| Direct dependencies (dev / peer) | 9 / 1 | 9 / 1 | 0 | same, `devDependencies` / `peerDependencies` |
| Unused files | 3 | 2 | −1 | `npx knip` (scoped by `knip.json`) |
| Unused exports | 80 | 77 | −3 | `npx knip` |
| Duplicate exports | 2 | 0 | −2 | `npx knip` |
| Duplicate blocks | 125 | 122 | −3 | `npx jscpd src scripts --min-lines 5 --min-tokens 50` |
| Duplicate percentage | 2.26% | 2.24% | −0.02 pp | `npx jscpd src scripts --min-lines 5 --min-tokens 50` |
| Circular dependencies | 0 | 0 | 0 | `npx depcruise --validate .dependency-cruiser.cjs src scripts` |
| Orphan modules (dep-cruiser warning) | 7 | 7 | 0 | same command; see note 1 |
| Modules unreached by any runnable path | 10 | 8 | −2 | `npm run unreached` |
| Lines in unreached modules | 1,708 | 1,180 | −528 | `npm run unreached` |
| Canonical workflow tests | 843 + 8 | 842 + 8 | −1 | `npm test` |
| Typecheck | pass | pass | — | `npm run typecheck:public` |
| Browser workflow passes | not applicable — no browser check runs in the default suite; Playwright is used only to capture evidence (`scripts/run-protected-browser-lane.mjs`) and needs browsers installed | | | |
| Production bundle size | not applicable — there is no bundler. `src/**/*.mjs` is what ships and what runs; the only build step compiles the optional Convex component | | | |
| Additions/deletions (whole repo) | — | — | +1,650 / −1,114 | `git diff HEAD --shortstat` |
| Additions/deletions (`src` + `scripts` only) | — | — | +83 / −1,029 | `git diff HEAD --shortstat -- src scripts` |

**Note 1 — why "orphan modules" did not move.** `dependency-cruiser`'s `no-orphans`
warns about seven modules, but three of them (`knockout.mjs`, `frame-evidence.mjs`,
`delivery-brief.mjs`) are published subpath exports in `package.json`: reachable by
a consumer, invisible to an import-graph scan of this repository. That is why
`npm run unreached` exists as a separate measurement — it walks from `bin`,
`exports` and `npm run` targets, which is what "runnable" actually means here.

**Note 2 — `npm run unreached` is new.** The "before" figures in its two rows were
produced by running the same script against the pre-change tree
(`git stash` → `npm run unreached`). The script itself does not affect what it
measures: it is a `scripts/` entry point and therefore a root of its own walk.

## What was deleted

| Path | Lines | Why it was safe |
|---|---:|---|
| `src/lib/official-pricing-proof.mjs` | 457 | No importer anywhere, and no test at all. Its `OFFICIAL_PRICING_*` constants duplicated validation that `validateOfficialPricingSnapshot` in `src/lib/agent-ease-campaign.mjs:482` already performs against a caller-supplied evidence file. `jscpd` flagged 22 lines of it as a clone of `submission-evidence-finalizer.mjs`. |
| `scripts/brain-graph.mjs` | 246 | Zero references in the entire repository — no npm script, no import, no doc, no workflow. |
| `scripts/probe-native-session-journey.mjs` | 163 | Same. A one-shot probe superseded by `test/native-agent-identity.test.mjs`. |
| `scripts/probe-execution-graph-journey.mjs` | 92 | Same, superseded by `test/execution-graph.test.mjs`. |
| `src/lib/integration-record.mjs` | 69 | Reachable only from its own test. Its deferral (`preflight-and-integration-records-unwired` in `deferred.yaml`) was closed on 2026-08-03 by wiring `preflight` and writing `integrations/ajv.yaml` — this half was never wired. |
| `test/integration-record.test.mjs` | 81 | Deleted with its subject. It exercised the module against inline fixture strings and never read the real `integrations/ajv.yaml`, so no check over committed data was lost. |
| `src/lib/npm-package-archive.mjs` — 2 alias lines | 2 | `verifyNpmPackageArchiveBytes` / `verifyNpmPackageArchiveFile` were re-exports of `inspect*` with zero callers: two public API names for one behavior. |

Total: **6 files, 1,108 lines, plus 2 alias exports.**

## What custom code was replaced by an existing capability

**Nothing, and that is a finding.** The reuse ladder was applied across `src/` and
`scripts/` looking for hand-rolled implementations of things the platform provides.
The searches and their results:

| Looked for | Command | Result |
|---|---|---|
| Hand-rolled CLI flag parsing | `grep -rn "parseArgs" src scripts` | already uses `node:util`'s `parseArgs` |
| Hand-rolled deep clone | `grep -rn "JSON.parse(JSON.stringify" src scripts` | 1 occurrence; `structuredClone` used 44 times |
| Hand-rolled deep equality | `grep -rn "function deepEqual" src scripts` | none |
| Hand-rolled hashing | `grep -rn "createHash" src` | `node:crypto` throughout |
| Callback-style filesystem | `grep -rn "require(\"fs\")" src` | none; `node:fs/promises` throughout |

The one substantial custom implementation that *looks* like a candidate is the tar
parser in `src/lib/npm-package-archive.mjs`. It stays. A published tarball is
untrusted input, and the module refuses path traversal, symlinks, sparse files,
duplicate entries and PAX abuse — behavior a general-purpose extractor does not
provide because extraction is not its threat model.

## Findings left unresolved, with the reason

Full detail and reproduction commands are in `docs/codebase/CONCERNS.md`. Summary:

| # | Finding | Priority | Why it is still open |
|---|---|---|---|
| 1 | 8 modules / 1,180 lines reached by nothing runnable | P2 | Deleting them is one `git rm`; **wiring** them is feature work, and refactoring rule 3 forbids mixing feature work into a structural pass. Six have a concrete one-import wiring step recorded; three need an owner decision about which gate enforces them. |
| 2 | `npm run check` fails from a standalone clone | P1 | It chains `ecosystem:check`, which validates sibling repositories under `--workspace ..`. Fixing it means changing what the aggregate gate means, which is a scope decision, not a cleanup. The four individual gates all pass. |
| 3 | `npm run evolution:verify` exits 1 on an unmodified clean checkout | P1 | Pre-existing and verified so (`git stash` at the parent commit reproduces it). The ledger cites a commit not in this history, and one assumption was edited in place instead of superseded. The fix is a ledger correction; rewriting ledger history is exactly the operation the ledger exists to make deliberate, so it does not belong inside a structural pass. |
| 4 | Ajv `strict: false` accepts misspelled schema keywords | P2 | Turning strict mode on may reject schemas currently in use across all 120 files. Needs its own pass with the resulting failures triaged, not a flag flip inside a structural change. |
| 5 | 77 unused exports | P3 | Most are deliberate public API that `knip` cannot distinguish from dead code, because the consumer does not exist in this repository. Separating them one by one is low-value compression — the stop rule. |
| 6 | `integrations/*.yaml` is validated by nothing | P3 | True before this pass as well; deleting the unwired validator only removed the appearance of a check. |
| 7 | `nodekit doctor` and `nodekit registry check` are the same command | P3 | Removing the duplicate name requires updating the registry conformance contract that asserts `command:doctor` exists. Cosmetic. |

**Two P1s remain open, so this pass reports `HUMAN_READY: BLOCKED`.** Both are
pre-existing, both are reproducible in one command, and both hit a new engineer on
their first day — which is precisely the population the gate is written for. Neither
is a code defect: one is a scope decision about what `npm run check` means, the
other is a ledger correction. Reporting them as blocking is cheaper than a cold
reader discovering them.

## One deletion that was reverted, recorded rather than hidden

`src/lib/research-verdict-benchmark.mjs` and its test were deleted in the first
batch on the same evidence as the others: reachable only from its own test.
`npm test` then failed with `behavior-index.json is stale` and
`orphanAnnotations: 31` — one more than expected. Tracing that single number showed
the file owned `inv:research-verdict-beats-constant`, and that `workspace.json`
registers `benchmarks/research-verdict-v1.json` as a committed corpus this was the
only code able to score. Both files were restored before the batch was finalised.

This is why the rule is "run the tests after every deletion batch" rather than
"after the reduction pass". The signal was a single integer in a generated index.

## Reproducing this report

```bash
npm ci
npm test                      # 842 + 8
npm run typecheck:public
npm run unreached
npx knip
npx jscpd src scripts --min-lines 5 --min-tokens 50
npx depcruise --validate .dependency-cruiser.cjs src scripts
```

`knip.json` and `.dependency-cruiser.cjs` were added in this pass. Without them
`knip` reports 278 unused files — almost all of them captured evidence under
`proof/` and `changes/` — and `dependency-cruiser` runs with no rules and therefore
cannot report a violation. A measurement command that measures the wrong thing is
not evidence, so the scope is committed alongside the numbers.
