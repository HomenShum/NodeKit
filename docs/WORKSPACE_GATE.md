# The WORKSPACE surface

One generated map that files every governance artifact in a repository under six fixed branches,
each named for the question an orienting agent asks. Runs at **launch and adopt time**, and its
check runs whenever the map's truth matters.

Schema: `schemas/nodekit.workspace.v1.schema.json`
Commands: `nodekit workspace index [--repo-root <path>]` · `nodekit workspace check [--repo-root <path>]`
Outputs: `WORKSPACE.md` (human) + `workspace.json` (machine), same content, repo root.

## Why this exists

Adopted 2026-08-04, modeled on how Notion keeps a workspace navigable: the top level never
changes, so anyone orients in thirty seconds no matter what the workspace contains. NodeKit's own
recorded failure is the inverse case: 116 schemas and a skill that mentioned two, so every
contract needed a human who already knew it existed. Coverage without navigation is what "a lot
of manual prompting" means. The artifacts were never missing — the map was.

## The six branches

Frozen. Stability of the top level is the product; sub-filing inside a branch is free-form.

| Branch | The question it answers | Files there |
|---|---|---|
| `record` | What was decided, measured, and proven? | capability contracts, production-agent contracts, adversarial verdicts, audience research, evidence packs, attestations, assumptions |
| `openThreads` | What is open, deferred, or unsettled? | `deferred.yaml`, unsettled bets |
| `agents` | Who works here, and what do they already know? | session contracts, agent definitions, skills, memory indexes — the discoveredFacts trail that compounds |
| `connections` | What external things are load-bearing? | `integrations/<lib>.yaml`, connector notes |
| `journey` | Where are we, and what happens next? | `hackathon.yaml`, builder cases, evolution ledger, delivery briefs |
| `platform` | What can I run from here? | `harness.yaml`, repo map, behavior index, runbooks — plus `nodekit explain` for the surfaces themselves |

## The rules

1. **Generated, never hand-maintained.** A curated index goes stale silently, and a stale map is
   worse than none. `workspace check` refuses an index that no longer matches the repository —
   the same freshness rule the repo map already enforces for code.
2. **Filed by question, not by producer.** Recognition is by `schemaVersion` (or a well-known
   filename), routed to the question the artifact answers. The next agent must not need to know
   which tool wrote the answer down.
3. **Absence is visible.** A contract-shaped file the router does not recognize lands in
   `UNFILED`, is listed in the map, and fails both commands. Silently dropping it would recreate
   the original routing failure one layer up.

## When it runs

- **Launch** (`nodekit-launch`, step 1): generate the map as part of orientation, before any work.
  The driven agent's first read in a repository is `WORKSPACE.md`, the same way its first command
  is `nodekit explain`.
- **Adopt**: an existing repository gets its map generated alongside the collision receipt, so
  adoption starts with navigation rather than archaeology.
- **Session handback**: `discoveredFacts` land in artifacts that file under `agents` — the branch
  that compounds. A session that returns only files makes the next session pay again for every
  discovery this one made.
