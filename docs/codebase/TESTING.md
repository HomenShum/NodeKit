# TESTING

## Run this first

```bash
npm ci
npm test
```

Expect **838 tests passing** in the repository suite and **8** in the Convex
component suite, in roughly two minutes on a modern laptop. No database, no API
key, no network, no browser.

## The commands

| Command | What it runs | When |
|---|---|---|
| `npm test` | fast lane (101 files) + Convex component | every edit |
| `npm run test:all` | all 106 files + component | before pushing |
| `npm run test:slow` | the 5 slow files only | when you touched submissions or evidence capture |
| `npm run typecheck:public` | `tsc -p tsconfig.public.json` | when you touched a `.d.mts` |
| `npm run check` | tests + typecheck + `npm audit --omit=dev` + registry + ecosystem | the full gate |
| `node --test test/<name>.test.mjs` | one file | while debugging |

## Why there are two lanes

`node --test` runs files concurrently, so the wall clock is set by the **single
slowest file**, not by the sum. Measured 2026-07-26: one acceptance proof took 236
seconds while the other 61 files finished inside it.

`scripts/test-files.mjs` splits them. The slow list is an explicit array of five
filenames, not a duration threshold, because a threshold measured on one machine
silently reclassifies files on another — and a test quietly leaving the default lane
is how coverage disappears. If a name in that list stops existing, the script exits
1 rather than printing a quietly smaller suite.

Nothing is deleted or weakened by the split. `npm run test:all` and CI run
everything.

## How tests are written here

- `node:test` and `node:assert/strict`. No framework, no mocking library.
- A test name states the **situation and the failure it prevents**, not the method
  under test: `"rejecting a proposal moves the run off the review stage"`.
- Tests that need a server start a real one on an OS-assigned port and drive it
  over real HTTP. `test/generated-project-gates.test.mjs` is the model — it exists
  because a regex assertion over the source could not catch the defect it protects.
- Tests that need a database skip with a recorded reason rather than passing.

## The three tests to know

| File | Proves |
|---|---|
| `test/factory.test.mjs` | `nodekit create` produces a directory that compiles and validates |
| `test/generated-project-gates.test.mjs` | the generated application's three decision outcomes over real HTTP |
| `test/caseflow.test.mjs` | the in-memory and SQL backends pass the same conformance suite |

## Two tests that fail for a reason that is not a bug

`test/repo-tour.test.mjs` and `test/behavior-index.test.mjs` compare a **generated**
index against the source:

```
repo-map.json is stale — run `npm run repo:map`
behavior-index.json is stale — run `npm run behavior:index`
```

You get these by adding or removing a module. Run the command, commit the
regenerated file. Editing the expected value in the test instead is the specific
failure `docs/ADVERSARIAL_GATE.md` exists to catch.

## The tours are tested too

`test/tours.test.mjs` re-resolves every step in `.tours/*.tour` against the current
source. Each step carries both a line number and the `pattern` it was anchored to;
the test asserts the pattern still matches exactly one line, and that it is the
recorded line. A guided tour that points at the wrong function is worse than no tour,
because the reader trusts it.

That test was verified to fail: changing one recorded line from 4 to 5 produced
`01-primary-user-flow.tour step 1 (src/cli.mjs:5): the code moved to line 4;
regenerate the tours`.

## Beyond the unit suite

| Layer | Command | Needs |
|---|---|---|
| Postgres conformance | `npm run conformance:postgres` | a reachable Postgres |
| Supabase conformance | `npm run conformance:supabase-local` | local Supabase |
| Browser evidence | `scripts/run-protected-browser-lane.mjs` | Playwright browsers |
| Trust-surface gate | `npm run gate:trust-surface` | nothing — runs on a fixture |
| Package install proof | `npm run proof:package-install` | network |
| Registry conformance | `npm run registry:check` | nothing |

## Before you say it works

`docs/ADVERSARIAL_GATE.md` is the standing rule and it is not optional. The short
form: a report is a set of claims, not evidence. Re-run the verification rather than
reading the code and nodding. Specifically hunt for a module with passing tests that
nothing constructs — this repository has shipped that exact bug, and
`docs/codebase/CONCERNS.md` lists the instances that are still open.
