# Mew notebook migration — the first real end-to-end NodeKit run

Planned 2026-07-29. This is not a demo of NodeKit; it is NodeKit **used in anger**: migrate the
owner's "mew" notebook out of Ideaflow into a Convex-backed app, serve it with a live agent, and
evaluate it against the test cases written in the owner's Notion notebook. Every gap closed this
week gets exercised by a real consumer, which is the only test of "closed" that counts.

## Why this is the right scenario

It traverses every stage with real stakes: real user data (the notebook), a real external system
with no guaranteed API (Ideaflow → the signed-in Chrome pillar), a real backend (Convex), real
acceptance criteria authored by a human somewhere else (Notion), and a live agent serving answers
(trust surfaces, for real). Nothing about it can be satisfied by a fixture.

## Stage map — every closed gap, exercised

| journey stage | what happens | the shipped thing it tests |
|---|---|---|
| RECON (pre-DECIDE) | harvest Notion test cases; probe Ideaflow export | fail-closed-on-unknowns doctrine |
| DECIDE | OpportunityContract: scope, schema mapping, what is NOT migrated | contract compiler + decision gate |
| REFERENCE | design-dna observations of 3 networked-note apps (Mobbin MCP, now authed) | reference loop, corpus gate, M-tiers |
| BUILD | `nodekit create` scaffold → Convex schema → importer with per-note digests | **PR #24 producer — first real BuildEvidencePack** |
| PROVE | chain gate on produced artifacts; trust-surfaces on the agent UI; Notion cases as scenario suite | journey-chain gate, trust-surface gate, placement gate on any new dep |
| LAUNCH | Convex deploy + web; LaunchManifest with rendered-DOM signal | launch-manifest schema's raw-http vs rendered-dom distinction |
| LEARN | ObservationPack from the live agent's test-case evaluation | observation-pack schema; unobserved dimensions stay first-class |

## Waves (agent time; verification between waves is the schedule, not dates)

**Wave 0 — recon, 2 agents parallel, fail closed.**
- A: Notion MCP → locate the test-case notebook, extract every case into
  `nodekit.story-pack`-style claims: id, given/when/then, source page id + block anchor. Prose
  cases that cannot be made falsifiable are recorded `unresolved: true`, never paraphrased into
  testability.
- B: Ideaflow export probe via signed-in Chrome (Pillar C, origin-scoped). Order: documented
  export → network-tab API observation → DOM harvest. Deliverable is a **sample of 5 notes with
  their links/tags**, plus a full-count estimate, plus the access method's receipt. If Ideaflow is
  unreachable, the wave STOPS and reports — no synthetic notebook. The RECON exit is a measured
  inventory: N notes, M links, K tags, exporter receipt.

**Wave 1 — DECIDE. One agent + owner.**
OpportunityContract for the migration. Material decisions the contract must force: which fields
survive (body, links, tags, timestamps, completion state), what happens to Ideaflow-specific
constructs (hashtag-plus syntax, backlinks), dedup policy, what is explicitly dropped. Owner
approves or defaults-with-disclosure — the trial-1 failure mode (silent decisions) is the exact
thing the BUILD pack will later reconcile against.

**Wave 2 — REFERENCE + BUILD, parallel then joined.**
- Reference agent: 3 design-dna observation records (Ideaflow itself, Notion, one more networked-
  notes app via Mobbin) — atomic facts only; corpus gate must pass.
- Build agent: scaffold via `nodekit create` (backend convex), schema (`notes`, `links`, `tags`,
  provenance columns: `sourceId`, `sourceDigest`, `importedAt`), importer that digests every
  source note and writes an import manifest (count in = count out + refusals, no silent drops).
- Join: **produce the BuildEvidencePack with the PR #24 producer** — honoured entries cite the
  importer manifest and test runs by digest. This is the pack's first non-fixture consumer.

**Wave 3 — PROVE + serve.**
Live agent (Convex action, provider via OpenRouter within the $100 grant) answers queries over the
migrated notebook. The Notion test cases become the scenario suite, run two ways: deterministic
checks where the case is mechanical (counts, link integrity, tag queries — the importer manifest
answers these), agent-evaluated where the case is semantic ("asking about X surfaces the note I
wrote about Y") — with the verdict hierarchy honoured: deterministic first, model judgment
advisory, **never blended into one score**. Trust surfaces on the agent UI: answers carry source
bindings (note id + digest); an answer with no binding renders as unbound, per story-pack rules.

**Wave 4 — LAUNCH + LEARN.**
Deploy; LaunchManifest with the rendered-DOM probe (`data-nodekit-artifact-*` on the served
notebook, observed in a real browser — the 1,310-byte-shell trap is documented and the schema
already refuses raw-http as proof). Then ObservationPack: which test cases passed/failed/could not
be evaluated, unobserved dimensions declared (no real-user traffic yet — that is `unobserved`,
not "no problems"). Chain gate walks all five artifacts: **the first fully-produced journey.**

## Hard constraints carried from this week

- Secrets: Convex/OpenRouter credentials never enter source or receipts; signed-in sessions and
  env vars only. The live Google-key incident is the reference case.
- The owner's real notebook is user data: the migration works on an EXPORT copy; nothing writes
  back to Ideaflow; the erasure contract applies to the new Convex tables from day one (deck-scoped
  lesson: every table carries provenance and is enumerable for deletion).
- Each wave's agent brief starts with "report what exists" and ends with probes in all three
  directions. Isolated worktrees, `--only` commits, exit codes on their own lines.
- Any new dependency must clear the placement gate (tools.yaml) before install — the first live
  use of PR #25.

## Kill / stop conditions (written before the result)

- Ideaflow unreachable after all three access routes → the migration half stops; the serve half
  can still run against the Notion-cases corpus, and the plan says so rather than substituting
  synthetic notes.
- If >20% of Notion test cases are `unresolved` (not falsifiable), pause and return them to the
  owner for tightening rather than grading mush.

## Owner inputs (the only human-time items)

1. Ideaflow signed in, in Chrome (Pillar C) — one sign-in.
2. Convex project credentials for the deploy target.
3. The Notion notebook's name/link if agent A cannot find it by search.
4. Wave-1 contract approval — the one decision gate that must be yours.
