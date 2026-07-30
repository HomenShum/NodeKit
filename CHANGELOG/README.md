# NodeKit — per-surface changelog index

This directory holds append-only changelog lanes for the public surfaces that
contributors and agents maintain. Each lane records the history of one runtime
module, command surface, contract family, integration, or other reviewable unit,
with the newest entry first.

## Why this exists

The repository-wide Git log answers what changed across NodeKit. A surface lane
answers what changed here, why it changed, and which adjacent surfaces moved with
it. Reviewers can therefore reconstruct a contract or command's evolution without
searching unrelated commits.

## Format rules

Read [`TEMPLATE.md`](TEMPLATE.md) before adding an entry.

- Prepend new entries directly below the lane header; never rewrite prior entries.
- Use `YYYY-MM-DD` dates and the seven-character commit SHA.
- For a change spanning multiple surfaces, add an entry to each affected lane and
  cross-link the other lanes with `**Touches**:`.
- Derive historical entries from `git log --follow` and the corresponding diffs.
  Do not infer or invent history.

## Index

### `contracts/` — public schema and package contracts

| Lane | Surface |
|---|---|
| [`contracts/stage-local-execution-graph.md`](contracts/stage-local-execution-graph.md) | Stage-local task, graph, edge-binding, runnable-frontier, and review-context contracts |

### `server/` — runtime and command modules

| Lane | Surface |
|---|---|
| [`server/execution-graph.md`](server/execution-graph.md) | Deterministic stage-local graph compilation, binding verification, and frontier derivation |
| [`server/cli-main.md`](server/cli-main.md) | NodeKit command-line routing, bounded JSON input, and user-facing command output |

## Adding a lane

1. Copy the file shape from [`TEMPLATE.md`](TEMPLATE.md).
2. Name the lane after the stable surface, dropping the source extension.
3. Inspect `git log --follow -- <source-path>` before writing history.
4. Prepend the new entry and cross-link every other lane affected by the same
   commit.

