# The MEASUREMENT LOG gate

Runs continuously during BUILD, and **blocks handoff**.

Schema: `schemas/nodekit.measurement-log.v1.schema.json`

## What it requires

Every time a belief is falsified by a measurement, record it: what was believed, what was
measured, what changed. Not the beliefs that survived — those are the code. The ones that
did not.

A deliverable ships with its measurement log attached.

## Why

Recorded from the Cheiron take-home, 2026-08-02.

Thirteen beliefs were held confidently and falsified by a single measurement each. Nine
changed shipped code, two changed the evaluation itself, two changed how the work was run.
Representative entries:

- *"Buckets partition the result set"* → measured 3,205 vs 2,915 and 3,602 vs 3,738. The
  error does not have a consistent sign. Reshaped the response schema.
- *"Bucket sum equal to total proves exclusivity"* → overlap and absent values cancel
  exactly. The check was unsound; exclusivity had to become a property of the dimension.
- *"17 counts are wrong"* → every one was correct; the eval was scoring a routing miss as
  eleven arithmetic failures. Two bugs, and the metric was the more dangerous one.
- *"Static embeddings will bridge drug aliases"* → the false pair outranked both true
  pairs. Feature demoted to corroboration-only.
- *"Canonicalisation will improve counts"* → measured identical, 394 vs 394. Feature
  removed after being built.
- *"~14 hours remaining"* → measured 19. Asserted repeatedly from a decaying estimate.

The pattern is uniform, and it is the point: **a plausible belief, held confidently, that
one measurement falsified.** Several were introduced by the fix for a previous one.

## The argument for shipping it

A reviewer cannot distinguish work that went smoothly from work whose problems were never
looked for. Both produce a clean final diff.

The measurement log is the difference. It is evidence that the system was *attacked* by
its author, and it is the only artifact that demonstrates this — a passing test suite
shows what was checked, never what was believed and found false.

It also inverts the usual incentive. A team that hides reversals has to keep hiding them;
a team that logs them gets credit for the rigour that produced them.

## The gate

1. **Log at the moment of falsification**, not at the end. Reconstruction loses the belief
   — you remember the fix and forget that you were confident of the opposite an hour
   earlier.
2. **Record the measurement, not the conclusion.** "Buckets overlap" is a claim;
   `3,205 vs 2,905` is evidence. Numbers, commands, outputs.
3. **Include your own process.** Wrong time estimates, misread agent output, a search that
   should have been a question. These are the entries a reader trusts the file for, because
   nobody fabricates them.
4. **Record reversals of your own fixes.** The retry-storm entry — where the repair caused
   the failure — is worth more than any entry about someone else's bug.
5. **Attach it at handoff.** `MEASUREMENTS.md` at the repository root, linked from the
   README.

## Refusal

A handoff whose measurement log is empty, or whose entries have conclusions but no
measured evidence, does not pass.

An empty log makes one of two claims: that nothing was believed and found false, or that
nobody was looking. On any non-trivial build the first is not credible, which leaves the
second.
