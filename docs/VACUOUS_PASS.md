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

## Open

`trust-surface-audit.mjs` has not been probed in the passing direction. Until it is, it is a
candidate instance of this class rather than a defence against it, and it should not be wired as a
gate.
