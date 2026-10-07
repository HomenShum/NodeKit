# The TITLE-SCOPE IDENTITY gate

Recorded from the Cheiron take-home, 2026-08-10 → 2026-08-11 (defect 78).

## The human situation first

Someone asks a system "how many melanoma trials use placebo?" The system
loses the word "placebo" on the way to its data source, correctly counts all
melanoma trials — 3,743 — and shows that number under the heading "Melanoma
trials using placebo." Every digit is real. The reader still walks away
believing something false, repeats it in a meeting, and cannot be corrected
by any amount of re-checking the number, because the number was never the
problem. The label was.

This happened, nondeterministically (3,743 → 120 → 3,743 → 120 across four
consecutive identical questions), in a system with a fully green test suite
on both sides of the coin flip. It was caught only because someone asked for
a screenshot.

**Paper note: a correct number under a wrong label is a wrong answer, and no
numeric check will ever catch it.**

## What the gate requires

1. **The label states the applied scope.** Every title, heading, or caption
   over a produced artifact is composed from what the system ACTUALLY did —
   the applied filters, the executed query, the consulted source — never
   from the user's question text. Model prose may help plan; it does not
   cross into the labeled artifact.
2. **Explicitly stated terms survive.** When the user names a constraint in
   so many words ("trials USE placebo"), deterministic code preserves it
   before and after any model-produced plan merges. A model may misread
   nuance; it may not silently widen an explicit request. Ambiguity ("A or
   B") is refused or clarified, never guessed into one term.
3. **Semantic identity is a hard condition, not a metric.** In any
   evaluation: if the artifact answers a different question than the one
   asked, the case FAILS regardless of how correct its numbers are. This
   outranks accuracy, latency, cost, and stability — because it is the one
   failure those four categories cannot see.
4. **The proof is named and re-runnable.** The gate's checkable form binds
   label + interpretation + count + the literal executed request into one
   identity (Cheiron's named proof: `title_scope_identity` — 4/4 fresh
   browser sessions, each cross-checked against an independent probe).
   Screenshot-level evidence is part of the gate: the terminal receipts
   certify the measurement path; only a capture certifies what a reader was
   told.

## When it runs

At the exit of any stage that renders a labeled artifact a reader could
carry away: an answer card, a chart, a report section, a dashboard tile, an
exported CSV header. Not front-loaded onto patches that render nothing.
