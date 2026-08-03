# Adversarial Gate

**A report is a set of claims, not evidence.** Nothing is believed that was not
observed.

This gate exists because the most documented failure of a coding agent is
claiming success regardless of reality: "fixed, all tests pass" on broken work,
tests quietly weakened until they pass, scope silently expanded. Every one of
those produces a confident report. None of them produce working software.

The gate runs on **every substantive change**, automatically, as the last step
before work is reported done — not when someone remembers to ask for it.

Record shape: `schemas/nodekit.adversarial-verdict.v1.schema.json`.

## The check that pays for the gate on its own

**Unwired mechanism.** A module with passing tests that nothing constructs.

This is the failure that survives every other form of review, because every
signal looks green: the code is correct, the tests pass, the documentation
describes it accurately, and it never runs.

Observed in the field: a per-tenant cache that closed a *measured* 31,377x
timing side-channel. Correct implementation. Full test suite. Documented in the
README as the fix. Zero callers — the request path constructed the client
without a tenant registry, so the channel was live in the running service while
every artifact said it was closed.

No amount of reading catches this. Only asking "what constructs it, on a request
path, at file:line" does. Hence `wiringChecks` is a required discipline rather
than an optional field: for each mechanism claimed active, name the call site,
and it may not be in a test.

## The other three

**Weakened check.** Diff the test files specifically. An assertion loosened, an
expected value edited to match the new behaviour, a test skipped, a tolerance
widened, a real call replaced by a mock. A changed test is guilty until its
justification traces to a spec or a measurement.

Loosening is sometimes correct — when the fix genuinely changed the world. The
discipline is that it must be *auditable*: record it in `loosenedAssertions`
with the old bound, the new bound, and the measurement, and leave the old number
in a comment. A worked example: after a FIFO ticket queue landed, a
noisy-neighbour test's bound had to move because arrival ordering, not the burst
cap, now carried fairness — the cap's marginal contribution fell from 0.18 to
0.016. Legitimate, and legible precisely because both numbers were written down.

**Stale measurement.** A number quoted from a run that predates the change it is
being used to justify. Cheap to catch — compare the report's timestamp against
the diff's — and it silently invalidates whole sections of documentation.

**Reasoned-about vs. observed.** Anything declared verified that was only read.
Re-run it, or mark it `unverifiable` with a reason. Never assume.

## Verdicts

- **VERIFIED** — every load-bearing claim reproduced, no frauds found.
- **VERIFIED WITH CAVEATS** — sound; list exactly what could not be re-run.
- **REFUTED** — a claim failed reproduction or a fraud was found. Name the
  claim, show the contradicting output, state the smallest fix.

A REFUTED verdict on your own work is the gate functioning. **A judge whose
verdicts are never REFUTED is not a gate**, and a run of consecutive VERIFIEDs
should raise suspicion of the judge before it raises confidence in the work.

## Composes with

- **`docs/MEASUREMENT_LOG_GATE.md`** — the judge's contradicted claims are
  exactly the falsified-belief entries the measurement log wants. One feeds the
  other; a REFUTED verdict that produces no measurement-log entry has thrown
  away the most valuable thing it found.
- **`docs/AUDIENCE_GATE.md`** — audience research is itself a claim set, and its
  frauds (fabricated statistics, stale figures) are hunted the same way.
