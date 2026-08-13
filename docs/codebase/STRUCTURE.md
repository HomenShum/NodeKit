# STRUCTURE

**The single most useful fact about this repository: 2,118 tracked files, and only
207 of them are code you can change.** Everything else is schemas, generated
indexes, or recorded evidence. A new reader who does not know that spends their
first hour in the wrong directories.

Counts below are `git ls-files <dir> | wc -l`, taken at the commit this document
ships in. Re-run it; if the number moved, this file is stale.

## Read these. They are the code.

| Directory | Files | What lives here |
|---|---:|---|
| `src/` | 161 | The package. `src/cli.mjs` is the entry point; `src/lib/*.mjs` is everything else |
| `test/` | 146 | `node --test` suites, one per `src/lib` module, plus end-to-end gates |
| `scripts/` | 47 | Runnable operations: proofs, benchmarks, evidence capture. Most are wired to an `npm run` name |
| `templates/base/` | — | The application that `nodekit create` writes out. Real running code |
| `adapters/` | 6 | SQL for the opt-in Postgres and Supabase backends |
| `schemas/` | 120 | The domain contract. Every shape the system agrees on, as JSON Schema |

Inside `src/`:

```
src/cli.mjs            4 lines. Routes to one of the two command families.
src/cli-main.mjs       2,911 lines. Every command except `reference`.
src/reference-cli.mjs  The `reference` family, loaded only when asked for.
src/index.mjs          The library's public exports.
src/lib/*.mjs          97 modules. One concern each; see ARCHITECTURE.md.
src/adapters/*.mjs     Postgres implementations of the caseflow interface.
src/component/         The optional Convex component (TypeScript, compiled to dist/).
```

## Do not read these first. They are records, not code.

| Directory | Files | What it is | When you would open it |
|---|---:|---|---|
| `proof/` | 876 | Captured evidence from past runs — hashes, receipts, screenshots | Investigating what a specific past run actually did |
| `evolution/` | 165 | The change ledger: observed failure → resolution → invariant → evidence | Asking *why* a rule exists |
| `reference-apps/` | 149 | Whole example applications, kept for comparison | Looking for a worked example |
| `changes/` | 87 | Per-change story packets | Reconstructing a specific change |
| `docs/` | 71 | Reference documents, one per topic | You already know the topic's name |
| `evidence/`, `dist/`, `promotion/`, `.qa/` | 143 | Captured artifacts, build output, gate scorecards | Rarely |

`docs/` is a reference shelf, not a reading order. Start at
[`docs/START_HERE.md`](../START_HERE.md).

## Generated files — never hand-edit these

| File | Regenerate with | Enforced by |
|---|---|---|
| `repo-map.json` | `npm run repo:map` | `test/repo-tour.test.mjs` |
| `behavior-index.json` | `npm run behavior:index` | `test/behavior-index.test.mjs` |
| `evolution/projections/EVOLUTION.md` | `npm run evolution:docs` | `npm run evolution:verify` |

If one of those tests says a file is stale, you added or removed a module and the
committed index no longer matches the source. Run the regenerate command and
commit the result. Editing the expected value in the test instead is the exact
failure `docs/ADVERSARIAL_GATE.md` exists to catch.

## Configuration at the root

| File | Owns |
|---|---|
| `package.json` | 56 npm scripts, the dependency list, the public export map |
| `nodekit.yaml` | This repository's own NodeKit declaration |
| `ownership.yaml` | Which surface each behavior belongs to |
| `architecture.yaml` | The five architectural parts named in the tour |
| `harness.yaml` | Installed agent plugins and skills, with their versions |
| `deferred.yaml` | Findings deliberately left open, each with the reason |
| `knip.json`, `.dependency-cruiser.cjs` | Scope for the two static-analysis measurements in `SIMPLIFICATION_REPORT.md` |
