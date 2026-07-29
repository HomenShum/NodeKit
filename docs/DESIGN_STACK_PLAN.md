# Design-stack level-up — three.js · gsap · motion-design · design-dna · genjutsu

Working draft, 2026-07-28. Status: **council out** — the same question is posted to three
differently-primed ChatGPT threads (NodeKit, NK-Mom's-Biz, Slide AI Collaboration, all at High).
Sections marked `[COUNCIL]` will be amended when the harvest lands; everything else is grounded in
local evidence and stands on its own.

## 0. What the five names mean, as far as the record shows

Mined: `~/.claude/skills`, both plugin caches, the marketplace set, all codex session logs, the
claude-mem observation store, and the graph-hop ledger.

| name | status | grounding |
|---|---|---|
| **three.js** | known library, used nowhere in our repos | zero references in NodeSlide/parity/node-platform src |
| **gsap** | known library, used nowhere | framer-motion v12 is the installed motion runtime (NodeBench) |
| **motion-design** | practice, partially built | motion tokens shipped in three repos; A–K motion gates in NodeSlide; "step-build, not scrub" ruling |
| **design-dna** | name not defined anywhere local | best local antecedent: the thread family's "Mobbin-style machine-readable breakdown for every application NodeKit encounters" + the `ReferenceObservation → DesignRule → ScoreReceipt` schema |
| **genjutsu** | **not defined anywhere local** — not in skills, plugins, codex logs, or transcripts | `[COUNCIL]` asked each thread to quote its own definition or answer NOT DISCUSSED |

An honest note the plan depends on: nothing here waits on knowing what genjutsu is. If the council
returns NOT DISCUSSED on it, the name gets assigned to the one capability below that has no name
yet (the illusion-of-life layer — §4.4) rather than inventing a sixth thing.

## 1. The constraint that shapes everything: vocabulary-not-library

Standing rulings, already tested twice and resolved as SCOPE:

- **The platform stays dependency-free.** NodeKit's claim is portable proof-carrying behavior; a
  platform that imports three.js has traded its claim for a bundle.
- **A generated app may vendor.** Mobbin/Uiverse/Anime.js/three.js/gsap are *sources a generated
  app compiles references into*, never platform core deps.
- So the platform owns **grammar** — tokens, specs, gates, receipts — and the app owns **runtime**
  — the libraries that execute the grammar.

Concretely, that split for this stack:

    PLATFORM (grammar, no deps)          GENERATED APP (runtime, vendored)
    motion tokens (duration/easing)      framer-motion | gsap — compiled from tokens
    choreography spec (order, stagger)   gsap timeline implementing the spec
    scene spec (camera, LOD, budget)     three.js scene implementing the spec
    design-dna records (observations)    components remixed from cited records
    motion receipts + gates              instrumented build emitting the receipts

`[COUNCIL — nodekit thread]` asked: what in this proposal would you refuse on platform-purity
grounds, and is design-dna just Studio Fabric's record format finally named?

## 2. What already exists (mined inventory — do not rebuild these)

**Skills/plugins already shipped:** `agentic-ui-qa` (persona QA vs the Agentic UI Bar),
`frontend-design` (aesthetic direction), `dataviz` (chart system + palette validator),
`before-after-proof`, `easier-to-read-submissions` (demo recording + DOM checks + **Gemini video
judge**), `drawio-skill`, Shadcn MCP, and the Mobbin remote MCP. Mobbin OAuth was completed and an
authenticated non-pixel canary passed on 2026-07-29.

**Buried assets the mining resurfaced:**
- `feature-walkthrough-gif` SKILL — 13 capture lessons, 5-stage pipeline ending in video judgment
- `Design Bridge` subroutine in solo-founder-nodes MASTER_SKILL
- `DESIGN_BENCHMARK.md`, `MOBILE_TASTE_AUDIT.md`, `6-16-2026-uiux-top-inspirational-references.txt`
- A 7-layer scroll-driven landing story (Jun 14) — the largest motion build to date
- Motion tokens with `prefers-reduced-motion` guards in three repos, three slightly different
  dialects (`--duration-fast` vs `--rd-dur` vs deck motion tokens) — **already drifting**, which is
  the strongest local argument that the grammar needs one home

**Verification doctrine that transfers:** NodeSlide's A–K motion gates; the **knockout gate**
(remove the element, re-render, compare — causality, not correlation); runtime canary playback
proof; "an audit that cannot fail is not a gate."

## 3. The reference problem motion actually has

Mobbin is screenshots. A motion reference cannot be a screenshot, and the Mobbin license already
rules out storing anyone's pixels — the durable corpus is **our observations**. So a motion
observation must be *derived from live inspection and stored as facts*:

    { kind: 'timing',       subject: 'modal-enter', property: 'duration', value: 240, unit: 'ms' }
    { kind: 'easing',       subject: 'modal-enter', property: 'curve', value: 'cubic-bezier(.2,.8,.2,1)' }
    { kind: 'choreography', subject: 'list-load',   property: 'stagger', value: 35, unit: 'ms/item',
      locatorDescription: 'items enter bottom-up, opacity+8px translate' }

`[COUNCIL — moms-biz thread]` asked for the schema extension done properly: 3 motion facts, 1
motion DesignRule with `mechanismHypothesis` + `confidence` + `appliesWhen/doesNotApplyWhen`, 1
ScoreReceipt citing fact ids, for a real salon screen.

`[COUNCIL — slide thread]` asked which of A–K transfer to DOM runtime as-is and what the knockout
equivalent is for a GSAP timeline (candidate: render with the timeline disabled, diff the
interaction recording, require the difference to be the *claimed* difference).

## 4. Proposed new skills (drafts — names and floors firm, details council-amendable)

Modeled on the marketplace set: each has a trigger, a floor any small model can execute, and a
ceiling that scales.

### 4.1 ~~`motion-grammar`~~ → **`motion-ladder` — already exists, shipped 2026-07-28**

Discovered mid-draft: `~/.claude/skills/motion-ladder` landed today and covers what this section
proposed, better. Six rungs (none → CSS → reviewed recipe → timeline engine → route-scoped smooth
scroll → isolated WebGL), each with an entry condition satisfied *before* the code; the gate is
"name the rung AND show the rung below is insufficient." It also carries three rules my draft
lacked:

- **Forbidden surfaces regardless of rung:** `proposal`, `conflict`, `failed_safe`, and every
  diff/review surface get NO motion — "motion that makes a not-yet-accepted change feel accepted
  is a correctness bug, not a polish issue." This binds directly to the agentic-ui-qa bar.
- **The four numbers:** 150–300ms feedback (hard ceiling 400), zero unguarded infinite animations,
  reduced-motion honored everywhere and collapsing to the *final state* — never a second design.
- **Motion as authorship:** the one place motion earns more than polish — a named gesture pair
  (human commit settles fast; agent proposal arrives then *waits*, because its state is genuinely
  unresolved). Applies to arrival only; the review surface itself stays still.

**Remaining work this plan owns:** unify the three drifting token dialects
(`--duration-*` / `--rd-*` / deck tokens) into one grammar file — motion-ladder *assumes* tokens
exist and calls a new bespoke curve "drift, not craft"; cross-repo, our three dialects are that
drift. Plus the per-surface motion receipt (declared tokens vs computed styles, reduced-motion
verified by toggling the media query in a real browser, not by grepping CSS).

### 4.2 `design-dna`
- **Trigger:** encountering any app (ours or a reference) worth learning from; every NodeKit
  BUILD phase before its direction gate.
- **Floor:** produce the machine-readable breakdown — atomic facts only (counts, measurements,
  relationships), retrieval tags naming the *problem* not the appearance; banned-adjective list
  enforced ("clean, beautiful, modern, premium" are unretrievable).
- **Ceiling:** DesignRules with mechanism hypotheses and confidence; ScoreReceipts that cite fact
  ids so a score is traceable to a reference; `firstSeenAt/lastVerifiedAt` re-verification since
  sources stay remote and uncached.
- **This is the REFERENCE gate's data source** — `referenceProvenance` on render receipts points at
  these records.

### 4.3 `scene-craft` (three.js) — now scoped as motion-ladder rung 6 tooling
- Rung 6 already demands a `references/PROOF.md` with measured performance and accessibility
  numbers *before the code exists*. scene-craft is the skill that **produces** that proof and the
  scene spec behind it — it does not relitigate whether 3D is allowed; the ladder decides that.
- **Trigger:** a build proposing rung 6 (or rung 4 with 3D ambitions).
- **Floor:** scene spec (camera, lighting, LOD, interaction map) + the perf budget (frame time,
  draw calls, bundle delta) that fails closed + a non-WebGL fallback carrying the same
  information — 3D is presentation, never the only path to the content.
- **Ceiling:** shader work, scroll-scrubbed camera paths, instancing.
- **Vendored into the app. Never into the platform.** The spec is the platform's; the scene is the
  app's.

### 4.4 `motion-proof` (the unnamed layer — candidate name: genjutsu, pending council)
- **Trigger:** any claim that "the animation works" or "the interaction feels right."
- **Floor:** extend `feature-walkthrough-gif`'s 5-stage pipeline into a gate — capture the flow,
  run the Gemini video judge with a *rubric derived from the motion spec* (not "does it look
  good": "does the modal enter in ≤300ms with the declared easing, do list items stagger
  bottom-up, does reduced-motion produce a cut not a slide").
- **Ceiling:** the knockout gate for motion — re-render with the timeline disabled and require the
  recorded difference to equal the claimed difference; perceptual thresholds on canary pixels
  (the slide thread's route-3/route-5 instrument, finally built, on the web where it's cheaper).
- This is the piece that keeps the whole stack honest: without it, motion work is vibes with a
  token vocabulary.

### 4.5 `trust-surfaces` — shipped 2026-07-28, from a cross-session convergence

Two sessions independently found the same rule from opposite sides: motion-ladder's *"motion that
makes a not-yet-accepted change feel accepted is a correctness bug"* and the
`data-agent-web-consent` gap (consent posture silently vanished from the DOM — nothing failed).
One class: **on any surface where trust is decided, the affordances carrying the decision must be
inspectable and must not be styled to imply an outcome.** Two clauses — machine-readable state
(existence asserted, not just value) and no outcome-implying styling (motion, success tokens, or
copy) on undecided things. Previously enforced in two places by two instruments, which is exactly
how one clause went missing without failing anything. Now one skill, one gate.

## 5. Combination recipes `[COUNCIL will add/amend]`

**A — Consumer app screen (salon vertical):**
`design-dna` (3-5 reference records for the screen's problem) → direction gate (cites records or
declares novel-by-intent) → `frontend-design` (aesthetic direction within the citations) → build
with `motion-grammar` tokens → Shadcn/Uiverse remix where cited → `agentic-ui-qa` personas →
`motion-proof` video judgment → render receipt with `referenceProvenance` + motion receipt.

**B — Data dashboard:**
`design-dna` on 2-3 audience-proven dashboards → `dataviz` (palette/form rules) → `motion-grammar`
for state transitions only (data movement must encode meaning — a bar animating is a claim about
the data, so it goes through the same content-provenance gate as a number) → `motion-proof`.

**C — Slide deck with motion:**
NodeSlide pipeline as-is → A–K gates on the OOXML side → `motion-proof` on the rendered web
preview → the deck's motion tokens drawn from the same unified grammar so deck and app motion
share one vocabulary.

**D — Landing page with a 3D hero:**
`design-dna` on 3 reference landings → `scene-craft` spec with perf budget → `frontend-design` for
the page around it → 7-layer scroll story only if the content genuinely has 7 layers →
`motion-proof` incl. the fallback path.

## 6. What is deliberately NOT proposed

- No three.js/gsap/anything into node-platform's dependency tree — §1.
- No stored Mobbin pixels — license, and the corpus is worth more as facts anyway.
- No "animation library evaluation" phase — the tokens compile to framer-motion today and gsap
  when a timeline is actually needed; the grammar is the investment, the runtime is swappable.
- No new judge — the Gemini video judge exists and already has 13 capture lessons baked in;
  `motion-proof` gives it a rubric instead of an opinion.

## 7. Sequencing

1. Unify the three motion-token dialects into one grammar file (smallest, unblocks everything).
2. `design-dna` skill — floor only (atomic facts + tags), because the REFERENCE gate needs it.
3. `motion-proof` floor — rubric-driven video judgment over existing pipeline.
4. `motion-grammar` skill wrapping the unified tokens.
5. `scene-craft` last — it has no consumer until a build justifies 3D.
6. Council synthesis lands → amend, then ship skills to the marketplace repo.
