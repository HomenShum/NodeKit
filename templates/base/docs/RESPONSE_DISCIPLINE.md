# Response discipline

How to write anything a person will read in this project — reports, answers,
commit messages, and every label on a produced artifact.

## Order of explanation

Normal human language first, then a concrete example, then the technical
term in parentheses, then one sentence usable as a paper note. A new reader
must be able to answer: who is doing the work, what are they trying to
accomplish, what can go wrong, what should the system do, why it matters.

## Traceability

Trace completed work back to the request: quote or paraphrase the part of
the ask each deliverable fulfils, so a long request can be audited against
what was actually done.

## Numbers and labels

Never state a number you did not just produce. Never label an artifact with
more than the system actually did.

The reason this is a rule and not advice: a system once answered "how many
melanoma trials use placebo?" by silently dropping "placebo", correctly
counting all melanoma trials, and titling the result "Melanoma trials using
placebo" — every digit real, the reader misled, the test suite green.

**Paper note: a correct number under a wrong label is a wrong answer, and no
numeric check will catch it — the title must describe the exact search the
system actually ran.**

## Claims beside measurements

When the project shows curated claims (a database's statement, a doc's
assertion) next to measured numbers: the claim carries its versioned source
and a link that re-returns it, fails loudly rather than reporting emptiness,
and is rendered so it can never be mistaken for a measurement. Two true
statements from two sources never combine into a third statement nobody
made.
