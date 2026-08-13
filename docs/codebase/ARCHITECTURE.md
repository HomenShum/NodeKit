# ARCHITECTURE

## The one invariant

**A saved result changes in exactly one function, and only when an approval names
the exact version it was written against.**

That function is `decideProposal` in `src/lib/caseflow.mjs` (line 289). If you
understand nothing else here, understand that: an agent may *propose*, and only an
approval carrying a matching `baseVersion` may *apply*. A proposal written against
version 3 of an artifact that is now at version 4 is marked `conflicted` and
nothing is written.

Every other design decision in this repository is downstream of that sentence.

## The human situation it protects

A person is working with a coding agent. The agent takes a while to think. In that
time the person edits the same document. When the agent's answer arrives, a naive
system applies it and the person's edit disappears with no error and no trace.

The version stamp makes that case *observable*. The person is told their change was
not applied, and the newer work survives. `test/generated-project-gates.test.mjs`
drives exactly this case against a real HTTP server, because the failure it catches
once shipped: the interface said "Completion verified" while the runtime had
actually contained a conflict.

## Five parts

`architecture.yaml` names these, `npm run repo:map` regenerates the mapping, and
`nodekit tour` prints them.

| Part | Entry point | Owns |
|---|---|---|
| **Contracts** | `schemas/*.json` | The shapes every part agrees on: what an application is, what a case is, what a receipt proves |
| **Factory** | `src/lib/scaffold.mjs` | Turning an empty directory or an existing repository into a working application |
| **Caseflow runtime** | `src/lib/caseflow.mjs` | The lifecycle a generated application runs: Case → Run → Stage → Artifact → Proposal → Approval → Receipt |
| **Proof and evaluation** | `src/lib/frontend-render-contract.mjs`, `src/lib/submission-gate.mjs` | Deciding whether a result is real, by generating evidence rather than accepting a claim |
| **Evolution Ledger** | `src/lib/evolution-ledger.mjs` | Recording *why* the system changed: observed failure, resolution, invariant, evidence |

## How a request flows

```
  shell
    │
    ▼
  src/cli.mjs ──────────────► src/reference-cli.mjs   (only for `nodekit reference …`)
    │
    ▼
  src/cli-main.mjs  main()          109 flat `if` branches, one per command
    │
    ├── runCreate ──► src/lib/scaffold.mjs      copies templates/base/ into the target
    │                     │
    │                     ▼
    │                 src/lib/agent-definition.mjs   reads it back, validates against schemas/
    │                     │
    │                     ▼
    │                 src/lib/schema-validation.mjs  Ajv2020
    │
    └── other commands ──► one module in src/lib/, one concern each

  the generated application (its own process, its own directory)
    │
    ▼
  agent/workflow.mjs  ──► createMemoryCaseflow (vendored src/lib/caseflow.mjs)
    │                          │
    │                          ▼
    │                     decideProposal   ◄── THE ONLY MUTATION
    │                          │
    ▼                          ▼
  apps/web/server.mjs     receipt (content hash of the run body)
```

`src/lib/` has no internal layering and no cycles — `npx depcruise --validate
.dependency-cruiser.cjs src scripts` reports 0. Modules import each other freely
but acyclically, and each owns one concern. The names are the map; there is no
`utils.mjs`.

## Three deliberate structural choices

**One giant dispatch file.** `src/cli-main.mjs` is 2,911 lines and holds every
command as a flat `if` in `main()`. A handler registry would be tidier and would
also mean that finding a command requires following three indirections. Searching
one file wins.

**Heavy command families are imported lazily.** `src/cli.mjs` picks between
`cli-main.mjs` and `reference-cli.mjs` before either is loaded, and several
commands inside `cli-main.mjs` use `await import()` at the point of use for the
same reason. Startup cost is a user-visible property of a CLI.

**The in-memory runtime is the reference implementation, not a mock.** SQL adapters
under `adapters/` are tested by running the same conformance suite against both and
diffing — see `test/conformance.test.mjs`. A paraphrase of the SQL in a comment
would not have caught the differences that suite catches.

## Where the boundaries are

| Boundary | Enforced by | What crosses it |
|---|---|---|
| Command line → factory | `runCreate` in `src/cli-main.mjs` | one validated options object; loose `--flags` do not |
| Factory → generated application | files on disk, then re-read | bytes, not objects — the validation runs on what landed |
| Agent → saved state | `decideProposal` | a proposal with a `baseVersion`; never a direct write |
| Application → external agent | `src/lib/atlas-mcp.mjs` | JSON-RPC over stdio, tool results only |
| This repository → a consuming project | `package.json` `"exports"` | 36 named subpaths; nothing else is importable |
