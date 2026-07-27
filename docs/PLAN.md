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
  already configured and needs one OAuth authorization by the owner in an interactive session
  (it cannot be done headlessly — standing blocker, decision queue #8). Until then, and for
  sources without an API: the signed-in Chrome path — browse the source, capture the pattern as
  an Atlas observation (screenshot + metadata + license + source URL) via `nodekit atlas add`.
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
  browser is the universal fallback and the only path for sources with no API (Mobbin capture,
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
- **Fabricated-data disclosure gate.** If fixtures/sample data exist in the build, the served UI
  must carry a user-visible disclosure marker, or the render contract hard-fails. Wire
  copy-claims' existing fabrication class (currently zero production callers) into the same seam.

### W3 — Reference pipeline (Pillar A)
- Mobbin OAuth in setup (owner action); CDP capture → `atlas add` flow for non-API sources.
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
| 8 | Mobbin OAuth (interactive session, owner) | open — blocks W3's API path |
