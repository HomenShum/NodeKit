# NodeKit revamp — reference-driven FDE harness

Written 2026-07-27, superseding the product plan of the same date. This IS the response trial 1
prescribed: first failure → fix the recorded frictions, rerun once. Second failure reclassifies
NodeKit as internal tooling + portfolio. That clock is running.

Grounding: trial 1 verdict (`evolution/artifacts/g-experiment-trial-1.md`), the thread's tool/agent
taxonomy and retrieval doctrine, and three owner decisions made 2026-07-27:

1. **"Senior quality" is retired as a goal.** It is not machine-assertable and chasing it produced
   gold-plating. The real, concrete thing: **maximized utilization of audience-proven reference
   sources** (Mobbin and the vetted external catalog discussed in the threads, plus Atlas) —
   NodeKit drives the coding agent to scramble, remix, and build from patterns real audiences have
   already validated, instead of inventing taste.
2. **Default standing spend: $100/month across everything** once full permission is granted — a
   deliberate minimum investment, freely adjustable by the user or dev by talking to their coding
   agent during NodeKit setup.
3. **Signed-in Chrome is the operational path.** The user signs into their accounts in Chrome once;
   the coding agent operates through that session via CDP for whatever setup, integration, and
   verification the build needs.

## 0. What NodeKit is, after the revamp

The user's coding agent — Claude Code, Codex, Hermes, Goose, Cursor, Devin — onboards NodeKit into
a repository, gets permission once, and from then on operates like a forward-deployed product
engineer:

    DECIDE      surface the product decisions, fail closed until approved or defaulted-with-disclosure
    REFERENCE   pull audience-proven patterns (Atlas + Mobbin + catalog) BEFORE designing
    BUILD       remix from cited references, license-checked
    PROVE       the existing evidence ladder + the honesty gates below
    LAUNCH      real deploy, within the standing grant, verified against the live DOM
    LEARN       friction and outcomes recorded to the ledger

NodeKit never puppets the agent. Every coding agent reads the repo it works in — AGENTS.md,
nodekit.yaml, MCP — so **the repository is the portable interface** and the harness is versioned
files plus gates. One process layer, any agent. This is the thread's "improve the harness, not the
model" rule and its "one service, several transports" rule, applied to process itself.

What does NOT change: the authority model (agent proposes, never approves), evidence generated
never asserted, derived beats hand-maintained, append-or-supersede, fail closed on unknowns.

## 1. What trial 1 proved, in one paragraph

The verification half already behaves like a senior engineer: its claims about the software were
re-run by an independent judge and held (6/6, 13/13, honest refusal of an unearned certification),
while the bare agent's "Verified" section had no artifact at all. The judgment half failed: 10
silent product decisions, ~17 categories of invented scope, 173 MB shipped for a one-page answer,
and every piece of trust apparatus pointed at a fabricated number labelled "your Square export."
The engine is right. The aim is wrong. The revamp is aim.

## 2. Pillar A — Reference maximization (the quality redefinition)

**Principle:** a screen justified by a cited, audience-proven pattern beats a screen justified by
an agent's taste. Quality becomes measurable: *what fraction of the shipped surface derives from
references the audience has already validated?*

- **Atlas is the internal half and already exists** — assets with observations, licenses,
  maturity floors, vetted recipes, reference-only benchmark entries. Its corpus is thin. Gap is
  ingestion, not architecture.
- **Mobbin and the external catalog are the audience-proven half.** Mobbin's MCP connector is
  configured and OAuth was completed on 2026-07-29. The authenticated canary is recorded as four
  attributed atomic facts through the provider-neutral reference loop. Mobbin pixels, screenshots,
  OCR, DOM, source payloads, caches, embeddings, RAG, and training use are prohibited. Sources
  without an API use the signed-in Chrome path to record the same non-pixel fact contract.
- **The REFERENCE gate:** directions must cite the reference assets they remix. A screen with
  zero provenance fails the direction gate unless explicitly flagged novel-by-intent — visible,
  never silent. Render receipts gain a `referenceProvenance` field (asset id or source URL,
  license, what was remixed). This also becomes the seed data for the UI Design Graph later —
  which stays a generated projection, never a source of truth.
- **License discipline:** remix is not copy. Atlas's allowlist + vendored-notice path is the lane;
  a direction citing an asset outside the allowlist fails closed.
- **Metric:** reference-utilization rate goes into the trial 2 rubric. Maximizing it is now the
  stated goal, replacing "senior quality" everywhere it appeared.

## 3. Pillar B — The standing capability grant ($100/month default)

The primitive already exists — signed trust policies, approval domains, assurance levels H0–H3 —
currently pointed only at ledger events. Generalize it to operations:

- **`nodekit trust grant`** — a conversation at setup, not a form. The agent proposes a
  capability manifest; the user adjusts it by talking ("make it $50", "no social posting"); the
  manifest is signed once under the existing trust machinery.
- **Manifest contents:** monthly spend cap (**default $100/month, all spend combined**), deploy
  targets and accounts, service-creation rights, Chrome origins the agent may operate on (Pillar
  C), and the actions that always re-ask regardless of grant.
- **Semantics:** inside the manifest → proceed without nagging. Outside → fail closed and ask.
  Every paid action debits a spend ledger with a receipt; at the cap, paid actions fail closed.
  `paidResourceActivation: human` becomes `within-manifest: proceed`.
- **Honest boundary, stated on every receipt:** a manifest signed with an agent-readable key is
  H1 — a policy statement, not cryptographic proof of human presence. The trust level appears on
  operational receipts exactly as it does on ledger promotions. No silent fallback.
- **Floor that no grant overrides** (the manifest template ships with these fixed): the agent
  never enters credentials by hand (signed-in sessions carry them — Pillar C), never exceeds the
  cap, and irreversible outward actions (publish, send, delete-permanent) must be named in the
  manifest or asked per-action.

## 4. Pillar C — Signed-in Chrome operations

The user signs into Chrome once — Vercel, Convex, Square, Mobbin, whatever the build needs — and
the agent operates through that session. This dissolves the credential-handling problem: the agent
never sees a password; the session is the permission.

- **Origin scoping:** the capability manifest lists the origins the agent may act on. An unlisted
  origin fails closed and asks. This turns "freely access whatever they need" into "freely access
  what was granted," which is the same user experience with an audit trail.
- **Operational receipts:** every CDP session that changes external state produces a trace —
  URLs visited, actions taken, screenshots at decision points. Operations become defensible the
  same way builds are. (The graph-hop CDP mechanics are the working reference implementation.)
- **LAUNCH gate, structural:** a deploy claim requires fetching the live URL and finding the
  promised DOM signal — the owner's live-DOM verification rule, promoted from memory to
  stage-exit condition. "Pushed" is not "shipped"; the gate makes the difference unforgeable.
- Prefer a CLI with a provisioned token where one exists (faster, steadier); the signed-in
  browser is the universal fallback and the only path for sources with no API (Mobbin inspection,
  account dashboards, one-off integrations).

## 5. Gap-close workstreams

### W1 — Subtraction (trial-1 mandated; do first, it's deletions)
- **Scaffold diet.** The client deliverable ships product + proof, nothing else. Agent tooling
  (`.claude/skills`, `.codex/skills`, `.nodeagent`, AGENTS.md/CLAUDE.md) is generated on demand
  for the working session, never committed into the client-facing tree. No throwaway directories.
- **Proof budget.** Cap and rotate: no 20 MB Playwright traces ×2 for a one-page app. Keep the
  certification JSON + a screenshot sample; archive the rest out of tree.
- **No unfilled templates ship.** `product/AUDIENCE.md` gets filled by the research phase or the
  scaffold fails closed. An unfilled placeholder shipping to a client is the improvisation the
  product exists to prevent.

### W2 — The two honesty gates (small, and they are the trial-1 loss)
- **Decide→Build decision gate.** The OpportunityContract must enumerate the material product
  decisions (data sources, revenue definitions like tips, week boundaries, owner draws, what is
  ignored) each marked approved or defaulted-with-disclosure. The journey contract derives the
  check; BUILD fails closed until it passes. This repoints the approvals that today gate only
  money and deploys.
- **Rendered Claim Provenance Gate** (replaces the fixture-marker gate I first proposed; that
  proposal was refuted 2026-07-27 and the refutation is better).

  My version was: *if fixtures exist in the build, the served UI must carry a disclosure marker.*
  It fails three ways. It is not necessary — generated synthetic data has no fixture file. It is
  not sufficient — unrelated test fixtures overfire it. And the overfiring is the fatal part:
  *"once it produces enough false positives, someone will add exceptions until the gate becomes
  decorative."*

  The distinction I had missed, and it is the whole finding:

      BUILD provenance   — how the software was constructed
      CONTENT provenance — what the displayed numbers actually depict

  Trial 1's receipts proved the first. The product lied about the second. Every assertion was
  true and the artifact still misrepresented itself to its user.

  The gate: **no consequential visible claim may imply user-owned, connected, current or factual
  data unless that exact claim is bound to an authority-issued source record.** Unbound or
  synthetic claims force the rendered surface into visibly disclosed demo mode.

  Language consistency is part of the contract, not decoration. These phrases require a real
  upload or connector binding — *"your Square export"*, *"from your account"*, *"actual revenue"*,
  *"current sales"*, *"based on your data"*. If origin is `fixture`, `synthetic`,
  `model_generated` or `unknown`, they are forbidden, and the page must say something
  unambiguous: **"Sample data — not connected to your Square account."** Not "Example". Not
  "Preview". Not a small demo chip beside an unrelated control. The misleading sentence is itself
  a claim and is validated as one.

  Derived metrics need more than a real source file. A rendered "repeat customer rate 63%"
  requires input sources, exact source digests, a named transformation and its version, and a
  recomputed output. If the transformation cannot be rerun the honest status is
  `derived_unverified`, and the surface discloses that.

  **The adversarial case to build first**, which beats my original gate outright: fixture
  laundering through a real-looking source — ship a legitimate Square CSV fixture, render a
  "Sample data" marker in the footer, then generate the headline metrics at runtime from a seeded
  random function. Fixture present, marker present, numbers invented, gate green.

  copy-claims' existing fabrication class (still zero production callers) wires into this seam
  rather than into the fixture-detection seam.

### W3 — Reference pipeline (Pillar A)
- [x] Mobbin OAuth and authenticated live canary; provider-neutral
  `observe → rule → score → verify` loop with a fail-closed source-policy gate.
- [ ] Obtain a purpose-bound S2/S3 detached receipt from the Mobbin adapter. OAuth proves the live
  session, but an unsigned MCP payload cannot independently authorize a durable release PASS.
- Seed corpus: 50 vetted assets for the small-business vertical (salon case first).
- Direction gate + `referenceProvenance` in render receipts.
- **Folds in the tournament unblock** (renderer + receipt producer wiring) — the direction gate
  needs both anyway; they stop being separate debt.

### W4 — Grant + operations (Pillars B/C)
- `nodekit.capability-manifest/v1` schema; `nodekit trust grant` setup conversation; spend
  ledger with receipts; origin scoping; deploy executor (CLI-first, CDP fallback); live-DOM
  LAUNCH gate.

### W5 — Standing debt (unchanged, resequenced below the pillars)
Artifact-bytes verification in `evolution verify`; `suite.green` consuming a real test-run
artifact; ease-proof's 147 substring greps; dashboard rows naming path/branch/commit (a repository
name is not a version); the 233s fast-lane test; PR #22's one-command owner approval — still the
single cheapest unblock in the queue.

## 6. Trial 2 — the exit condition

Same experiment, fixed methodology: opaque arm names, cost data outside the judged tree, judged
tree copied read-only, judge blind to which arm carried the tool. Run after W1+W2 minimum, W3
preferred. The rubric gains one criterion: **reference utilization** — did the build derive from
cited, audience-proven patterns?

Win → the FDE-harness vision has its first evidence, proceed to the beneficiary loop (real salon
owner). Lose → the kill criterion executes: NodeKit reclassifies as internal tooling + portfolio,
no appeal, per the plan that predates the result.

## 7. Decision queue

| # | decision | state |
|---|---|---|
| 1 | Approve+record the quality.yml event; merge #22 | open — cheapest unblock |
| 2 | $100/month default standing cap | **decided 2026-07-27** (adjustable at setup) |
| 3 | Signed-in Chrome as operational path, origin-scoped | **decided 2026-07-27** |
| 4 | Quality = reference utilization, not "senior taste" | **decided 2026-07-27** |
| 5 | Real salon contact for the beneficiary loop | open — blocks post-trial-2 |
| 6 | NodeSlide checkout resolution; parity-studio 0/8 row | open |
| 7 | Legacy 22 events stay unattested | default: leave; warning is the record |
| 8 | Mobbin OAuth (interactive session, owner) | resolved 2026-07-29; authenticated live canary PASS |
| 9 | parity-studio `role: domain-application` — accurate when parity was NodeSlide's home, false once Phase 4 resurfaces it. Proposer correctly says the edit should FOLLOW the Phase 4 merge, not precede it. | defer until Phase 4 lands |
| 10 | The registry has no way to express **"hosts code it does not own."** Between Phase 4 and Phase 3, parity's declared role and its contents will legitimately disagree — 1,139 NodeSlide items still stranded there. This is a vocabulary gap, not a parity problem, and it recurs. | open — worth a `hostsForeignCode` field |
| 11 | `measurementRevision: <full immutable SHA>` per registry entry, never `main`/`latest`/null, with `canonicalRemote` + `shippingManifestPath`; measurement resolves the remote, fetches that exact revision, detached-checks-out, and requires `manifest.repositoryCommit == measurementRevision`, failing `REGISTRY_REVISION_MISMATCH`. **A dirty working tree must never satisfy the check**, and **the measurement must assert `HEAD` actually resolves to the pinned SHA** rather than trusting a branch name it was handed. This is the fix for three measurement bugs found today, which share one root — *the thing measured was never bound to the thing named*: the dashboard scoring a 130-commit-stale checkout; the port audit scoring a dirty tree; and `parity-studio` reporting `unpushed: 0` for a `main` the checkout was not on while the real branch existed on no remote at all (`parity-studio/docs/PORT_TRIAGE.md` §13). The third is the one to design against — it did not look like a failure, it looked like reassurance. | open — recommend accept |
