# Dogfooding the NodeKit CLI — the authority seam

Captured 2026-07-26 by delegating real work to the CLI instead of hand-rolling it. Every result
below was executed. The real ledger was never written to; the promotion chain was proven inside a
throwaway git repository that was deleted afterwards.

## 1. An agent can write canonical, human-reviewed history with no human involved

    $ nodekit evolution draft --id x --track harness --category evaluation \
        --challenge p --resolution p --reviewed-by project-owner --evidence evd:...
      interpretation.status: "human-reviewed"
      reviewedBy: "project-owner"

    $ nodekit evolution record --file <that draft>
      RECORDED to evolution/events/harness/x.json
      canonical record status: "human-reviewed"

Two commands. No human was asked anything.

`recordEvolutionRecord` gates on `record.interpretation?.status !== "human-reviewed"`
(evolution-ledger.mjs:147). That is the same field `draftEvolutionEvent` writes. The gate checks a
value the caller controls.

### The status is not even taken from the flag

evolution-ledger.mjs:129 hardcodes it:

    interpretation: { status: "human-reviewed", reviewedBy: input.reviewedBy, ... }

`--reviewed-by` supplies only the name. Every draft NodeKit produces is born approved.

### Root cause: there is no draft type

    schemas/nodekit.evolution-event.v1.schema.json
      interpretation.status: { "const": "human-reviewed" }

`human-reviewed` is the ONLY value that validates. An agent-proposed event is not merely
discouraged, it is **inexpressible**. "Draft" is a canonical event written to a different
directory, and the directory is the only thing separating proposed from approved — while `record`
will promote any file it is pointed at.

This is the same shape as the evidence-supersession gap found earlier the same day: the ledger
mandates a discipline its schema gives no way to express, so every user routes around it. There,
`mutation: append-or-supersede` with no supersession field. Here, "the agent cannot approve its own
changes" with no non-approved status.

### The guard exists, in the wrong tool

    $ node scripts/propose-evolution.mjs --status human-reviewed ...
      ERROR refused: this tool cannot write interpretation.status=human-reviewed.
      exit=5

A hand-rolled script in `scripts/` refuses the move that the sanctioned command performs by
default. The authority guard lives only in the tool written to work around NodeKit.

### Why this is not fixed here

The fix requires a schema decision with a real fork, and schemas are a material path:

- **A.** Add a draft schema whose status is `agent-proposed`, and have `record` promote by rewriting
  status only under an approval it verifies.
- **B.** Widen the status enum and move the gate off the field entirely, onto a detached signature.
  `src/lib/repair-approval.mjs` already implements Ed25519 with domain separation, so a signature
  for one purpose cannot verify for another.

B relocates the problem to key custody: if the agent can read the signing key on the machine it runs
on, nothing changed. That question is open and belongs to the owner, not to this artifact.

## 2. The documented invocation of `evolution draft` cannot succeed

The usage line lists six flags. The schema requires `evidenceIds` to have at least one item, and
`--evidence` is not in the usage line. Supplying every documented flag fails every time:

    nodekit: evolution event draft validation failed:
    evolution event draft/evidenceIds must NOT have fewer than 1 items

Nine flags the handler reads are absent from `--help`: `evidence`, `assumptions`, `invariants`,
`limitations`, `failure`, `repository`, `project-id`, `commit`, `pr`.

## 3. The Codebase Tour is invisible to the person it was built for

`nodekit tour` runs. `nodekit journey verify` runs. Neither appears in `nodekit --help`. The command
built so a senior engineer can orient on an empty Windows screen is absent from the first thing that
engineer would type.

## What this does not establish

That these are the only authority holes. Three commands were exercised end to end out of roughly
seventy in the help output. The Atlas, frontend, harness, models, skills and routing surfaces were
not driven at all, and no claim is made about them.

## The pattern

Every defect found sits at a **seam**, never inside a component:

    the write path        versus  the file path      (ledger immutability, fixed 2026-07-25)
    the help text         versus  the handler        (nine undocumented flags)
    the script            versus  the command        (guard present in one, absent in the other)
    the declared rule     versus  the checked rule   (status is asserted, not proven)

NodeKit makes **evidence** well and **authority** poorly. It can prove what happened, to a hash,
against a commit. It cannot yet prove who approved it. Attestation is a string the caller writes,
and every gate downstream trusts that string.
