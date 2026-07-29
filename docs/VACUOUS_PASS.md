# The vacuous pass

Named 2026-07-28, after a fifth instance in a single day across three repositories and two
sessions. Until now each was written up as its own footnote. They are one class.

## Definition

**A vacuous pass is a green result produced by an instrument that measured nothing.**

Not a wrong answer — a *well-formed answer about an empty subject*. The check ran, the assertion
held, the number was computed, and none of it touched the thing it names. Vacuously true, in the
logician's sense: every element of an empty set satisfies any predicate you like.

It is more dangerous than a false negative, because a false negative looks like a failure and gets
investigated. A vacuous pass looks like the outcome you wanted.

## The instances, all real, all from one day

| instance | what was measured | what it appeared to prove |
|---|---|---|
| reduced-motion guard killing `transition` in a template that declares none | nothing | motion is accessibility-safe |
| `getComputedStyle` reporting `animationName` inside a `display:none` subtree | unpainted nodes | "17 infinite animations" on a page whose painted count was zero |
| GSAP knockout via `timeScale(0)` + jump-to-end | the same end state the un-knocked-out run produces | the animation is load-bearing |
| `doAct` silently ignoring an unrecognised action name | a frozen viewport | four captioned steps of a successful capture |
| a schema with `additionalProperties: false` rejecting the field its own new gate requires | nothing — validation failed first | *(the inverse: a gate that cannot pass)* |
| `git rev-list --count main..origin/main` while `HEAD` is a feature branch | a stale ref | "your work is safe" |
| a GitGuardian check summary counting occurrences, read as an incident count | history, not incidents | a second finding that never existed |

Three of these were produced by the person who had documented the class earlier the same day.
That is not irony; it is the point. **The class is invisible from inside the instrument** — every
one of these reads as correct if you only look at the output.

## The tell

Ask, of any green result: **what would this have reported if the subject did not exist?**

If the answer is "the same thing," the check is vacuous and its green is worth nothing. Every
instance above fails that question.

A second tell, for gates specifically: **probe both directions.** An audit that cannot fail is not
a gate; an audit that cannot pass is not one either. Confirming only the failing direction is how a
gate ships that nothing can satisfy; confirming only the passing direction is how a gate ships that
nothing can trip.

## The standing rule this generalises

The parity gates already enforce `absence is not-run, never passed`, and the NodeKit interaction
contract already says *"the system must never change 'not run' to 'pass'."* Both are correct and
both are narrower than this class: they govern what a gate reports about a **missing** subject.

The vacuous pass is broader. The subject can be present and still unmeasured — painted-but-not-
animated, imported-but-never-mounted, declared-but-never-installed, scanned-but-in-a-different-
tree. So the rule extends:

    absence is not-run, never passed
    AND
    an instrument must state what it measured, not only what it concluded

The second clause is what makes the first enforceable. A check that reports `PASS` and nothing else
cannot be audited for vacuity. A check that reports `PASS — 41,026 lines across 125 files` can:
a reader who expected 200,000 lines learns immediately that the scope was wrong.

## What this obliges, concretely

- **Report the denominator.** Files scanned, elements matched, states exercised, commits covered.
  A count of zero must be visible, not folded into a pass.
- **Report `NOT_RUN` distinctly from `PASS`,** and never render it as green. A surface a heuristic
  could not reach is unknown, not clean.
- **Keep filtered-out populations visible.** `motion-inventory.mjs` reports painted and hidden
  counts separately for exactly this reason; folding them together reintroduces the bug the split
  exists to prevent.
- **An unrecognised instruction is a failure, never a no-op.** A runner that skips a typo'd action
  produces a recording of nothing that looks like a recording of something.
- **Probe both directions before shipping any gate.**

## Two extensions, found by probing (2026-07-28, same day)

### A reporter is not a gate, and nothing in its output says so

`trust-surface-audit.mjs` was almost packaged as a gate. Probing it found something worse than an
unproven pass direction: **it had no verdict at all.** It printed `surfaces=2, affordances=0,
consentAttrs=0` and stopped. No PASS, no FAIL, no NOT_RUN. It had been read as a gate for an entire
session because *the numbers looked like a result.*

    an instrument that only reports is safe until someone treats its output as a verdict,
    and nothing in the output stops them

This is adjacent to the vacuous pass rather than an instance of it — it cannot conclude vacuously
because it never concludes. But the consequence is identical: a green-looking artifact standing in
for a judgement nobody made. **A tool that computes facts must either state a verdict or state that
it has none.**

### The guard-shaped member: a precondition check that verifies a *proxy* for the precondition

`requireChromium` — the guard written *specifically* to keep these gates from failing vacuously —
had the defect itself, and it was caught by the other session applying this document's own test to
it.

It caught `ERR_MODULE_NOT_FOUND`: the *module* being absent. It did not catch the far more common
half-install, `npm install playwright` **without** `npx playwright install chromium`. In that state
the import succeeds, the guard returns happily, and the run dies much later at `chromium.launch()`
with "Executable doesn't exist at …".

That is not a vacuous pass by itself — it still exits non-zero. But it fails in the wrong place
with the wrong message, and **the guard measured the package rather than the browser**. Apply this
document's own tell and it falls immediately: *what would this check have reported if the browser
did not exist?* The same thing it reports when it does.

    module presence stood in for browser availability
    the way prose stood in for a declared trust state

Both look like they are checking the real thing. Every other instance in this document is an
instrument measuring an empty subject; this one is a **precondition check whose subject is a
stand-in for the precondition**. Distinct enough to name separately, because the fix is different:
not "measure something" but "measure the thing itself" — here, `chromium.executablePath()` plus an
`existsSync`, which is synchronous and launches nothing, so proving the real capability is cheap.

Probed in three states before shipping, since the fix arrived unproven and unproven is the whole
subject of this file: module absent → throws about the module; module and binary present → returns;
missing-binary branch predicate → `true` on a missing path, `false` on the real one.

### A test that measures the platform's rollback instead of the code's ordering

From the deck-erasure envelope, 2026-07-28. The envelope's whole claim is *ordering*: it checks
both ceilings **before the first write**, so an oversized deck is refused rather than partially
processed. The obvious test is "call it with an oversized deck, then assert nothing was deleted."

That test is vacuous, and the reason is subtle enough that it was nearly written:

> convex-test rolls a `t.run` back when its handler throws, so asserting "nothing was deleted" from
> outside the transaction measures **the rollback**, not the ordering — it would pass against an
> implementation that deleted everything and only then noticed.

Same green, same assertion, and it proves the platform works rather than the code. The fix is to
swallow the error **inside** the transaction so the post-state is observed before rollback can
launder it.

This also corrected the premise I had written into the task: I described the envelope as preventing
a "half-deleted deck." Convex mutations are transactional, so half-deletion was never the literal
failure mode. What the envelope actually buys is a *named* refusal, a *measured* cliff a test can
sit on, and a bounded read set — a refused erasure now reads one row past the envelope instead of
the whole workspace. Checking before the first write remains the right structure precisely because
it makes the property hold **independent of** the platform's rollback, rather than relying on it.

The generalisation, which is not specific to Convex:

    if your test would pass against an implementation that does the right thing for the wrong
    reason, it is measuring the environment, not the code

### A gate with no PASS fixture is half-built

The sharpest rule of the day, and it explains why "probe both directions" is not symmetric advice:

    the failing direction cannot detect over-matching

Building the PASS fixture immediately exposed two real bugs that were invisible from the FAIL side:

1. **The gate ignored the very attribute it demanded.** Surface enumeration matched on *prose*
   (`/propos|conflict|failed|error|review/`). NodeRoom's boot FAILED state — which carries
   `data-boot-state="failed"` — has copy reading "Could not open the room," containing no trust
   word, so the gate returned **0 surfaces** on a surface that literally declares failed state.
   Meanwhile it flagged two marketing landings for the phrase "Review every change." **Failing in
   both directions at once, on one heuristic**, and loudly enough that the miss was hidden by the
   noise. Fixed: a surface qualifies by *declaring a state* (definitional) or by trust language
   co-located with a real decision affordance.
2. **Nested double-counting.** After fix 1, a `<main>` wrapping a proposal card qualified as a
   second surface and threw a clause-1 failure against a wrapper never meant to declare state. The
   compliant fixture went red — which is how it was caught. Only the innermost qualifying element
   is kept now.

Neither was reachable from the failing direction. A gate that only fails loudly can be
simultaneously over-matching and under-matching, and its noise conceals the miss.

Related discipline: the self-test must exercise the **real** probe, not a duplicated copy of it. A
self-test against a re-implementation proves the copy works — this class again, one level up.

### Defending the boundary that was never silent

The `update_theme_v1` port was briefed on a stated blast radius: adding the op without the Convex
validator member would produce "valid TypeScript that the server rejects at the wire." The agent
tested that claim instead of accepting it, and it is **wrong** — deleting the validator member
produces **8 `convex tsc` errors**, because downstream types derive from it via `Infer<>`. It would
never have shipped silently.

The genuinely silent boundaries were somewhere nobody was looking: `externalChangeSet`'s
`new Set<PatchOperation['op']>([...])` and external-agent's `requireOneOf([...])` are **plain string
lists**. A missing op typechecks perfectly and is rejected at the wire with a generic message. The
header also named three owners; there are five.

So the fear was real and pointed at the wrong place. **A documented blast radius is a claim, and it
decays like any other** — the two boundaries it named were watched, and the two it did not name
were the ones that could fail in silence. Both now derive from a
`satisfies Record<PatchOperation['op'], true>` table rather than keeping hand-written copies.

Verified by injection rather than argument: a hypothetical `set_deck_locale_v1` member produces
**22 distinct compile errors**, each at a site that needs a decision. That is what makes the
exhaustiveness guard a gate rather than a comment.

### Receipts computed from the traversal that performed the work

Named by the other session after a third instance in one day, and it is the sharpest formulation of
the family:

> **erasure receipts assert completeness from the traversal that performed the deletion, so
> anything the traversal could not reach is invisible to the claim by construction**

Three instances: an orphaned `_storage` blob, the unbounded `collectNodeSlideScopedRows`, and
`DERIVED_SWEEP_LIMIT` reading only the first 512 `nodeslide_agent_runs` while the schema pass
deleted *all* of them — stranding run 513's budget row behind an id no deck-anchored query can
reach, under `remainingDeckRows: 0` and `retentionSafe: true`.

This is the vacuous pass with a receipt attached. The check is not merely uninformative; it
actively **asserts safety over surviving user data**, and it is structurally incapable of noticing,
because the thing that measures completeness is the same thing whose incompleteness is in question.
The general defence is an *independent* backstop — a count or query that does not share the
traversal's reachability assumptions.

### A tripwire is not a gate, and may still be worth keeping

`assertNoStrandedBudgetRows` has **no reachable trigger** once both strand paths are closed at the
source: its knockout comes back green. By the rule in this document that would make it a candidate
for deletion — an assertion that cannot fail is not a gate.

It was kept, with the argument written into the source, and the argument is right: every other
derived table has `countJobDerivedRows` as an independent backstop, and the budget cluster
structurally cannot, because its id dies with the job. Without the assertion, a future traversal
change yields a green receipt over surviving spend data **with no failing test anywhere**.

So the rule needs a distinction it did not have:

    a GATE proves a property holds today — one that cannot fail proves nothing
    a TRIPWIRE guards against a future change — it is SUPPOSED to be unreachable now

Both must be probed. The difference is what a green knockout means: for a gate it is a defect, for
a tripwire it is the expected state. **A tripwire must say in its own comment that it is one**,
along with why no cheaper backstop exists — otherwise the next reader deletes it to keep the
knockout table tidy, which is exactly the tidying this document exists to prevent.

## Resolved / Open

- `trust-surface-audit.mjs` — **retired.** Replaced by `trust-surface-core.mjs` (probe + verdict),
  `trust-surface-selftest.mjs` (three fixtures: PASS, FAIL, NOT_RUN — all green, verified
  independently), and `trust-surface-live.mjs`. Live results: NodeRoom boot FAILED state **PASS**,
  two landings **NOT_RUN**, fixture built to break it **FAIL**.
- The self-test is not optional dressing. It is the only thing standing between that file and the
  class it exists to defend against, so the two ship together or not at all.
