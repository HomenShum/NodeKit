# Start here

You are looking at **NodeKit**, and this repository is the *platform* — the thing that generates
applications and then proves what they did. It is not itself the application. That one sentence
resolves the most common wrong turn.

New here? Do these four things in order. It takes about ten minutes.

## 1. Install, then check your setup

```bash
npm install
```

```bash
npm run tour
```

`tour` verifies your environment and orients you. Steps marked `[ ok ]` were actually checked
against your machine; steps marked `[note]` are explanations, not verified claims — the tour is
explicit about which is which.

If a step fails it tells you the fix. Nothing else on this page will work until it passes.

## 2. Know what problem this solves

A coding agent given a vague brief makes product decisions *while* it writes code. The work comes
back technically strong and pointed at the wrong thing, and you re-prompt. Repeat.

NodeKit's answer is to decide the boundary **first** and make the agent build against it: who the
user is, what the job is, what is explicitly out of scope, and what the agent may not do. Then it
requires evidence — not assertions — that the result matches.

Unfamiliar words in that paragraph or in `README.md`? [GLOSSARY.md](GLOSSARY.md) defines them.
Terms like *figured-out*, *domain-blank*, and *proof-carrying* are NodeKit-specific and are not
guessable.

## 3. See the shape of the system

```bash
npm run repo:map
```

Five parts own everything. You should be able to name them after the tour:

| Part | Owns |
|---|---|
| **Contracts** (`schemas/`) | The typed shapes everything agrees on |
| **Factory** (`src/lib/scaffold.mjs`) | Turning a directory into a working application |
| **Caseflow runtime** (`src/lib/caseflow.mjs`) | Canonical lifecycle plus its disposable bounded-loop execution projection ([contract](docs/EXECUTION_GRAPH_OF_LOOPS.md)) |
| **Proof** (`src/lib/frontend-render-contract.mjs`) | Deciding whether a result is real, by generating evidence |
| **Evolution Ledger** (`src/lib/evolution-ledger.mjs`) | Recording why the system changed |

`repo-map.json` is generated from source, never hand-written, so it cannot quietly go stale.

## 4. Trace one real action

Read `advanceStage` in [`src/lib/builder-journey.mjs`](src/lib/builder-journey.mjs). It is the whole
governing rule in one function: **a case cannot advance a stage unless that stage's artifact exists
and a receipt binds it by content hash.** A forged or mismatched reference stays blocked.

That single function is the system in miniature. Understand it and the rest follows.

## Then: make one small change and prove it

```bash
npm test
```

```bash
npm run evolution:verify
```

If you changed `src/`, `schemas/`, `templates/base/`, `harness/`, `nodekit.yaml`, `ownership.yaml`,
or `.github/workflows/`, that is a **material** change and needs a reviewed Evolution Ledger entry
before it can land. See [GLOSSARY.md](GLOSSARY.md#material-change) and
[docs/EVOLUTION_LEDGER.md](docs/EVOLUTION_LEDGER.md).

## Where to go next

| You want to | Read |
|---|---|
| Generate an application | [README.md](README.md#from-a-brief-to-a-running-app) |
| Understand a term | [GLOSSARY.md](GLOSSARY.md) |
| Work on this repo as a coding agent | [AGENTS.md](AGENTS.md) |
| Understand why a decision was made | [docs/DECISIONS.md](docs/DECISIONS.md), [docs/EVOLUTION_LEDGER.md](docs/EVOLUTION_LEDGER.md) |
| See the full command list | `node src/cli.mjs --help` or `repo-map.json` |

`docs/` holds 28 reference documents. They are references, not onboarding — do not start there.

## One honest note

NodeKit's proof machinery is further along than its explanations. This page and the glossary exist
because a measured cold-start pass found 11 undefined terms in the first five lines of the README
and a first command that ran before the install step. Those findings are recorded in
`harness/journey/baseline-2026-07-24.json`. If something here still does not orient you, that is a
finding worth recording, not your mistake.
