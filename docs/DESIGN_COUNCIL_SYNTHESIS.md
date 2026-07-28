# Design council — three threads, 2026-07-28

One question, three differently-primed threads, all answered: **NodeKit** (20,565 chars),
**NK-Mom's-Biz** (29,120), **Slide-AI** (21,458). Total ~71 KB.

Posting note worth keeping: I nearly double-posted. The body had already been sent by a sibling
session acting on my delegation, and the check that caught it was the ledger's own collision rule —
read the last turn's author before assuming a thread is idle. It found a *generating* turn citing
Three.js and GSAP, which is what a live answer to my own question looks like from the outside.

## AGREEMENT — unanimous, and therefore load-bearing

**1. Do not mint `genjutsu` as a layer. 3/3, independently.**
- NodeKit: *"Do not mint genjutsu as another layer. At most use it as an internal…"*
- Mom's Biz: *"Do not mint a sixth independent system. Use Genjutsu as an adversarial profile
  inside motion-proof."*
- Slide-AI: *"'Genjutsu' is useful internally, but too ambiguous to own architecture."* — and
  proposes the public name **Motion Deception Corpus**.

Three priors, one verdict. The owner's fifth name is a *profile*, not a product. The intended home is
`motion-proof/profiles/genjutsu.yaml`; that profile file is **not present in this repository as of
2026-07-28**, so this document does not claim it shipped.

**2. `design-dna` is Studio Fabric's record format, finally named.** NodeKit says so outright;
Mom's Biz says the structure was already there as ReferenceObservation → DesignRule →
ScoreReceipt; Slide-AI says the ideas existed but never as a formal contract. So the skill shipped
this morning is not new architecture — it is a name for a thing three conversations had each half-
built.

**3. Libraries live only in generated applications, never in NodeKit core.** Unanimous, and all
three drew the same boundary:

    NODEKIT CORE (dependency-free)          GENERATED APPLICATION
    MotionIntentSpec                        CSS
    ChoreographySpec                        Framer Motion
    rung decision + motion tokens           GSAP
    adapter contract + import gate          Three.js
    proof schema + generator templates      route-local implementation

NodeKit adds the distribution nuance: optional adapter *recipes* and conformance tests may ship,
but **no automatically installed runtime dependency**. And a rung mapping with a real constraint —
*"GSAP may enter the generated application only after rung 3 is proven insufficient."*

**4. Deterministic instrumentation outranks the video judge.** Both threads that answered the
canary question produced the same hierarchy without seeing each other:

    runtime instrumentation   authoritative for timing, order, state, performance
    DOM + trace evidence      authoritative for structure and user flow
    video judge               advisory / perceptual only
    human audience study      authoritative for audience usefulness

Named primary instruments: `Element.getAnimations()`, Web Animations API timing,
`animationstart/end` + `transitionrun/end`, PerformanceObserver, long-task observer, rAF sampling,
DOM mutation timeline, focus timeline, GSAP adapter callbacks, Three.js renderer stats, Playwright
trace, final DOM/state hashes.

And the reporting rule: **never blend into one motion score.** Report
`Deterministic: PASS / Video judge: 3-of-4 / Human: pending` as separate lines.

## CONTRADICTIONS — both against me, both correct

**C1. My `motion-proof` made the video judge primary. Wrong.** I built the skill around the
Gemini judge because it existed. The council's hierarchy inverts it: video is a *re-observation* of
something the browser already knows exactly. `Element.getAnimations()` answers "did it actually
run" with no video at all. **Corrected in the shipped skill.**

**C2. My knockout implementation was a known gaming route.** I specified GSAP `timeScale(0)` +
jump-to-end. Slide-AI lists verbatim: *"GSAP knockout jumps to the end and falsely passes"* —
because the end state is exactly what the un-knocked-out run produces too. The knockout must remove
the **mechanism** (stub the adapter, never construct the timeline), not fast-forward it.
**Corrected in the shipped skill.**

Both corrections landed within an hour of the skill shipping, which is the argument for consulting
before hardening rather than after.

## NOVEL — one thread only

**The Motion Deception Corpus (Slide-AI).** Seven fixtures that pass a naive motion check:

    exists but never mounts · animation targets an off-screen decoy · screenshots differ only
    because of a clock · trust surface animates toward apparent approval · reduced-motion renders
    a different design · GSAP knockout jumps to the end and falsely passes · video shows motion
    the live application does not contain

Note #4 — *motion toward apparent approval* — is the trust-surfaces violation in its most dangerous
form, arrived at from a completely different direction. And #6 was a real defect in this skill's
own first draft: **the gate's author is not exempt from the corpus.**

**A motion evidence hierarchy (Mom's Biz), M0–M3.** M3 audience-task evidence > M2 live
shipped-product observation > M1 official demo/documentation > M0 recipe or showcase. This is the
answer to "Mobbin is screenshots": a showcase is the *weakest* tier and may never promote a rule to
audience-proven.

**PPTX caveat (Slide-AI).** For NodeSlide exports the real PowerPoint playback canary stays
stronger than a browser video: *"The video judge reviews the playback. It does not prove that the
PPTX timing structure is active."*

## VERDICT

The design stack is **four skills plus four missing stages**, not five new libraries. Sequenced:

1. **`motion-token-harmonizer`** — the only stage all three threads named that is already a
   measured defect: three dialects drifting across three repos. Floor: inventory, map to canonical
   semantics, detect conflicts, generate migration aliases, emit a drift report, preserve behavior
   until migration. **Do this first; it is small and everything else assumes one vocabulary.**
2. **`motion-design`** (choreography spec producer) — library-neutral ChoreographySpec with
   triggers, order, overlap, interruption, cancellation, final state, reduced-motion final state.
   Unlocked at rung 2+.
3. **`motion-runtime-probe`** — the deterministic instrument layer from C1. This is what makes
   motion-proof's verdicts real rather than perceptual.
4. **`motion-reference-capture`** — M0–M3 tiering, licence mode, atomic temporal observations.
   Feeds design-dna.

Deferred: `3d-asset-conformance` (no consumer until a build earns rung 6), `motion-audience-
validation` (needs real users — the same blocker as the beneficiary loop).

**Not adopted:** nothing was rejected outright, but `motion-adapter-conformance` folds into the
adapter contract NodeKit core already owns, rather than becoming a separate skill.

## Ledger deltas

All three thread nodes need updating: each answered a substantial question today, and two of them
corrected shipped code. `design-dna` and `genjutsu` move from "defined nowhere" to defined, with
`genjutsu` demoted to a profile name and `Motion Deception Corpus` as its public form.
