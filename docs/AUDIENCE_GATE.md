# The AUDIENCE gate

Runs **before** the first architecture decision, and before REFERENCE.

- **REFERENCE** asks *what does good look like* — observed facts from shipped products.
- **AUDIENCE** asks *who is looking, and what do they call it* — the organisation that
  will judge the work, the stack they name, the needs they state.

Schema: `schemas/nodekit.audience-research.v1.schema.json`

## Why this exists

Recorded from the Cheiron take-home, 2026-08-02.

The system was built, hardened, evaluated (31/31 cases, 331 numbers verified, 339/339
trace steps replayable) and only then was the company researched. The research would have
changed the framing from hour one:

- Their core product is a **Life Sciences Knowledge Graph**. The submission's weighted
  entity graph was being described as a bonus feature rather than as the thing closest to
  what they build.
- The job description says *"ground AI-generated outputs in source data with traceable,
  verifiable citations so they can be trusted in real pharma"*. That is almost verbatim
  the invariant the system had independently been built around — and it was written up as
  engineering hygiene instead of as their stated requirement.

The artifacts already fit. They were described in the wrong language for a day.

**The cost is asymmetric.** Research is ~15 minutes. Reframing afterwards is hours. A
stack mismatch is unrecoverable.

## The gate

1. **Read, do not recall.** Company site, funding news, the actual job description or
   brief, investors, founders' backgrounds. Record every URL in `sources`, including
   fetches that failed — a 403 is a fact about what you could not check.
2. **Extract three things.**
   - `productThesis` — what the system IS to them, quoted in their words.
   - `namedStack` — technologies they explicitly name, each with its source.
   - `statedNeeds` — a JD's bullets are a literal list of what they need.
3. **Map each stated need to an artifact.** Anything unmapped goes in `gaps`.
4. **Use their vocabulary.** Same artifact, their words. This is the cheapest possible
   improvement to a deliverable and it is usually skipped.
5. **Declare the gaps.** An unnamed gap reads as an oversight; a named one reads as
   judgement.

## The failure mode this gate also prevents

A hunch about an audience is not evidence.

On the same take-home, seeing "knowledge graph company" produced an immediate instinct to
switch the datastore to Neo4j — a rewrite. The job description explicitly named
**Postgres**. The original choice (Postgres when persistence is needed, no graph DB for
graphs of ≤6 nodes per side) already matched their stack; acting on the hunch would have
moved *away* from it.

So `namedStack` requires a `source` and a `confidence` of `stated` or `inferred`, and
`correctionsAvoided` records what the research stopped. **Check the document before
changing anything.**

## Refusal

A BUILD phase that names an audience but has no AUDIENCE record, or a record whose
`sources` are empty, does not pass. Recollection about an organisation is exactly how a
stack gets guessed wrong, and the guess is discovered at review time.
