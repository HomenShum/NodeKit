# NodeKit — the overall plan

Written 2026-07-27 against `origin/main` at `e9201e79` (PR #21 merged) with PR #22 open.
Synthesized from the NodeKit ChatGPT thread (read through its newest two exchanges, 2026-07-27),
the related threads (Slide AI Collaboration, NK-yC-S26, NK-Mom's-Biz), the Evolution Ledger
(22 events), and the gates as they derive today.

**Status claims in this file rot.** Where a claim is checkable, the command that checks it is
named. Trust the command over the prose, and the prose only as of the date above.

---

## 1. Thesis

NodeKit is the vehicle that carries a builder from an idea to a live, improving product:
**DECIDE → BUILD → EXPLAIN → LAUNCH → LEARN**, with proof cross-cutting every stage. The gates are
stage-exit conditions, not the product. The founding pain is the reprompt loop — a coding agent
making product decisions while coding — and the founding fix is the OpportunityContract: an
approved boundary the agent builds against instead of improvising.

Entry model (decided in-thread, replacing the original assumption): the user does not open
NodeKit. **The user opens Codex or Claude Code, opens a repository, and asks the coding agent to
use NodeKit.** NodeKit installs into the repository and guides and verifies from inside it.
The technical stack comes after the adoption path — always.

Two journeys are optimized at once: the **user's** journey through the product, and the
**engineer's** journey through the repository. A person starting from an empty screen must be able
to understand the mission, run it, trace one action, make one small change, and prove it, without
private coaching.

## 2. Doctrine that survived contact

These rules were each violated at least once, caught, and are now enforced in code. They are the
constitution; new work that conflicts with them is wrong until proven otherwise.

1. **The agent proposes; the agent does not approve.** Enforced end to end since #20/#21: drafts
   are born `agent-proposed`; `human-reviewed` is derivable only from a signed, single-use,
   domain-separated approval; trust levels H0–H3 with no silent fallback. Verified by
   `test/evolution-approval.test.mjs` (14 cases) and the adversarial CLI probe (11 cases).
2. **Evidence is generated, never accepted.** Verify recomputes; a claim without a named artifact
   is an overclaim. `npm run journey:verify` exits non-zero on any hand-edited check.
3. **Derived beats hand-maintained.** repo-map.json, behavior-index.json, EVOLUTION.md,
   ECOSYSTEM_STATUS.md are all generated; their tests fail when they go stale. Every
   hand-maintained status table this project ever had went stale within hours.
4. **A value's presence is not its role.** The recurring bug class (~12 confirmed instances:
   grep-as-claim, exit-code-for-the-wrong-reason, matching-turn-count-as-identity,
   coverage-that-searched-nothing). Every gate that survived does so by checking meaning, not
   presence. New checks must state what they do NOT establish.
5. **Immutable history, append-or-supersede.** In-place edits to committed records are detected
   against the introducing commit, from bytes on disk. Binding repairs are allowed and reported;
   claim changes block.
6. **Adoption path before tech stack.** From the research-phase correction: an incumbent is
   neither a veto nor automatic validation; the G/A/N/R procedure decides, fails closed on
   unknowns, and must be able to say do-not-build.
7. **Graphs and indexes are generated projections, never new sources of truth.** (Newest thread
   exchange, converging unprompted with rule 3.)

## 3. Where we actually are

### Shipped and gated (main)

| pillar | state | check |
|---|---|---|
| Builder journey J0/J1 | builder-case, opportunity-contract, build packet; salon fixture | `npm run journey:verify` (11/12; 12th underivable by design) |
| Codebase tour | START_HERE, GLOSSARY, repo-map, `nodekit tour` | same |
| Behavior Index | 22 invariants, 22 symbol-owned, bound to proving assertions | `npm run behavior:index` |
| Evolution Ledger | 22 events; immutability + authority enforced | `nodekit evolution verify` |
| Approval chain | trust init → approve → record, H0–H3 | `test/evolution-approval.test.mjs` |
| Atlas | retrieval + honest benchmark; ranker on probation (fielded ranking not proven superior) | `nodekit graph benchmark` |
| Suite performance | slow lane 20min-timeout → 8m20s green; CLI 708→269ms | PR #22 |

### Known-broken or unproven, in priority order

1. **PR #22 is red.** `verify` blocks on materiality for `.github/workflows/quality.yml` — one
   file, needs one approved evolution event. **Owner action; an agent must not self-approve it.**
   `test` failure is downstream of the same branch state; re-runs after the event records.
2. **The ledger's 22 events are 0/22 attested** (promoted before enforcement; reported honestly
   rather than back-filled). Standing debt, visible in every `evolution verify` run.
3. **The frontend tournament cannot run.** Directions exist; **nothing renders them** and
   `assembleFrontendRenderReceipt` has zero non-test callers. DECISIVE is reachable only from
   receipts nobody produces. This is the single biggest gap between "engines" and "vehicle."
4. **Three gates have holes found by the 2026-07-26 sweep, deliberately left for review:**
   evidence *artifacts* aren't byte-verified on disk (records are); `journey-contract`'s
   `suite.green` derives from the behavior index and cannot observe a test run;
   `test/ease-proof.test.mjs` is 147 substring greps of 161 assertions.
5. **The fast lane is not fast.** submission-gate has a 233s test; submission-preparation has four
   over 80s; five fixture-dependent files sum to ~1,279s. Improved by the PNG fix but unresolved.
6. **The research-verdict corpus is underspecified** — no case carries a measured gap, so it
   scores agreement with a judgement, and correctly says so in its `knownDefect` block.
7. **copy-claims has zero production callers.** The classes exist; the gate isn't wired to any
   pipeline. (Todo #22 as written is stale — close it and open the wiring item instead.)

### Decided in-thread, not yet started

- **NodeCase** (consulting engagement workspace composing NodeRoom+NodeSlide+NodeProof…) — the
  corrected Lilli answer. Parked: it is a composition play that presupposes the journey loop works.
- **UI Design Graph** — generated projection over contract/Atlas/flows/behavior-index/receipts;
  literature-backed (WebDesignIter +9.55pp Pass@2). Parked behind the tournament being runnable,
  because its inputs include render receipts that don't exist yet.
- **Retrieval core service** — one `searchContext()` service, several transports (CLI/HTTP/MCP/
  subagent); SQLite+FTS first, vector only when the lexical benchmark fails, graph only for
  relationship/temporal questions. The second-brain server and `recall.mjs` are working prototypes
  of exactly this shape.

## 4. The plan

The ordering principle: **close the loop before widening it.** NodeKit has never carried one real
case through all five stages with proof at each seam. Until it has, every new subsystem is another
engine bolted to a vehicle that hasn't driven.

### P0 — Unblock (owner, ~15 minutes)

1. Run the approval chain for the `quality.yml` materiality event (commands in PROGRESS.md):
   `trust init` → `evolution approve` → `evolution record`. Merge PR #22 when green.
2. Decide the standing question this creates: do the 22 legacy events stay `unattested` (honest,
   noisy) or get re-approved under the new chain (a day of ceremony)? Recommendation: leave them;
   the warning is the record.

**Exit:** PR #22 merged, CI green on main, `npm test` fast for every future session.

### P1 — Close the Build→Explain seam (the tournament, ~1–2 sessions)

The missing physical piece is small and known: a renderer for the three directions and a wired
receipt producer.

1. Implement the direction renderer (static HTML render of each candidate against the salon
   contract — no live model calls; the tournament evaluates artifacts, not generation).
2. Wire `assembleFrontendRenderReceipt` into a `nodekit frontend render` command; receipts include
   screenshot hashes that must exist on disk (closing the sweep's "hashes nothing checks" hole).
3. Run the tournament end to end on the salon contract. Ship the first DECISIVE verdict produced
   from real receipts. Record the evolution event via the approval chain.

**Exit:** `nodekit frontend plan → directions → render → benchmark → canary` runs on the salon
case with zero hand-authored artifacts. Todo #21 closes.

### P2 — First full journey on the real vertical (salon, ~1 week of sessions)

DECIDE (contract exists) → BUILD (tournament output) → EXPLAIN (StoryPack from real receipts) →
LAUNCH (local demo counts; LaunchManifest recorded) → LEARN (one ObservationPack; one friction →
gym → ledger repair cycle on a real observation).

**Exit:** one `builder-case` with all five stage receipts, walkable by `nodekit tour`, demoable to
a stranger. This is also the YC/demo narrative artifact.

### P3 — Harden the gates the sweep indicted (parallel with P2, small PRs)

1. Artifact byte-verification in `evolution verify` (same pattern as record immutability).
2. `suite.green` must consume a real test-run artifact (timestamped result file the CI writes),
   or be renamed to what it actually checks.
3. Replace ease-proof's substring greps with behavior-index-style symbol checks, file by file.
4. Wire `auditCopyClaims` into one real pipeline point (PR template or `nodekit check`).
5. Fast-lane heavy tests: profile the 233s submission-gate test the same way the PNG cost was
   found — measured, not guessed.

### P4 — Retrieval core + UI Design Graph (only after P1–P2)

1. Extract `searchContext()` as one service with CLI/MCP transports, absorbing `recall.mjs` and
   the second-brain server's lessons (localhost-default, token-gated, read-only, coverage always
   reported). SQLite+FTS only; the vector/graph escalation each require a failing benchmark first.
2. Generate the UI Design Graph as a projection (rule 7), feeding it render receipts from P1.
3. Revisit NodeCase only when a second real vertical demands composition.

## 5. Risks

- **Self-approval regression.** Any new "convenience" path that writes review status is the old
  bug. The tests exist; keep them in the fast lane.
- **Gate theatre.** The sweep found three gates that pass without observing. Fixing them (P3) can
  wait; *trusting* them cannot — until fixed, treat `suite.green` and ease-proof as advisory.
- **Measurement contamination.** Two nights were partially lost to orphaned test processes and
  piped exit codes. The discipline is written into the artifacts: kill-and-verify-zero before
  timing, `$?` on its own line, absolute paths for cross-shell files.
- **Scope gravity.** NodeCase, the design graph, and the retrieval service are all real — and all
  downstream of a loop that has never closed. The wedge stays: one builder, one vertical (salon),
  one journey, proven.

## 6. Owner decision queue

| # | decision | default if silent |
|---|---|---|
| 1 | Approve+record the quality.yml event (P0) | PR #22 stays red |
| 2 | Legacy 22 events: leave unattested vs re-approve | leave, keep the warning |
| 3 | H2 credential (passkey/hardware) or stay H1-dev | stay H1; receipts say so |
| 4 | 15-trial matrix: keep 180 imgs/manifest or shrink | keep; coverage is the point |
| 5 | Close stale todo #22, open "wire copy gate" | done in this plan |
