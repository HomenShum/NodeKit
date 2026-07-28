# Builder Journey — inter-stage contract

Written 2026-07-28 as the frozen interface for a parallel build of the four missing stages.
**This document is the only thing preventing four agents from inventing four incompatible artifact
shapes.** Anything not fixed here is the implementing agent's choice; anything fixed here is not
negotiable without changing this file first.

## Measured starting state

    opportunity-contract     schema: 1   src refs: 3    ← exists, shipped in J0/J1
    build-evidence-pack      schema: 0   src refs: 0
    story-pack               schema: 0   src refs: 0
    launch-manifest          schema: 0   src refs: 0
    observation-pack         schema: 0   src refs: 0

Four of five stages exist as names in prose. `src/lib/journey-contract-verify.mjs` references none
of the five artifact identifiers, so the journey is currently unverifiable end to end.

## The chain

    DECIDE   OpportunityContract   (exists)
    BUILD    BuildEvidencePack     consumes OpportunityContract
    EXPLAIN  StoryPack             consumes BuildEvidencePack + OpportunityContract
    LAUNCH   LaunchManifest        consumes BuildEvidencePack
    LEARN    ObservationPack       consumes LaunchManifest + StoryPack

`StoryPack` and `LaunchManifest` both consume `BuildEvidencePack` and **do not consume each
other** — they are the one genuinely parallel pair at runtime, not merely at authoring time.

## Frozen: the envelope every artifact shares

Every stage artifact is a JSON document with these fields at the root. No exceptions, no stage
inventing its own casing or nesting.

```jsonc
{
  "schemaVersion": "nodekit.<artifact-name>/v1",   // exact, lowercase, hyphenated
  "caseId": "<string>",                             // identical across all five for one journey
  "stage": "decide|build|explain|launch|learn",
  "producedAt": "<ISO-8601 UTC>",
  "inputs": [                                       // EVERY upstream artifact consumed
    { "schemaVersion": "...", "caseId": "...", "sha256": "<lowercase hex of canonical JSON>" }
  ],
  "content": { /* stage-specific, the implementing agent's design */ },
  "completeness": {                                 // see below — this is the load-bearing part
    "claimed": ["..."],
    "notRun": ["..."],
    "refused": [{ "item": "...", "reason": "..." }]
  }
}
```

### `inputs` is a binding, not a label

`sha256` is over the **canonical JSON** of the upstream artifact (sorted keys, no insignificant
whitespace). A stage that cannot produce the digest of what it consumed has not consumed it — it
has been handed a name. This is the same rule the artifact-showcase receipts already enforce, and
it is what makes the chain checkable rather than assertable.

### `completeness` exists because of the vacuous pass

Every artifact must state **what it did not do**, not only what it did. `notRun` is never empty
merely because it was inconvenient to fill; an empty `notRun` is a claim that everything in scope
was attempted. See `docs/VACUOUS_PASS.md` — a stage that reports only its conclusions cannot be
audited for having measured nothing.

`refused` carries reasons. A refusal with a reason is a success; a silent omission is the failure
this whole apparatus exists to catch.

## Frozen: what each stage must answer

Deliberately stated as *questions*, not field lists — the field design is the implementing agent's
job, and prescribing it here would make four agents into four transcription clerks.

| stage | must answer |
|---|---|
| **BuildEvidencePack** | Which decisions in the OpportunityContract were honoured, which defaulted-with-disclosure, and which contradicted? What was built, and what evidence *generated* (never asserted) supports each claim? |
| **StoryPack** | What is the claim being made to a human, and which BuildEvidencePack entry binds each claim? Which claims have no binding? |
| **LaunchManifest** | What was deployed, where, under whose authority, at what cost against the standing grant? What DOM signal proves it is live? |
| **ObservationPack** | What actually happened after launch, from which source, and what did NOT get observed? |

## Frozen: authority

No stage artifact may contain a field that asserts its own approval. `reviewedBy`, `approved`,
`verdict: human-reviewed` and equivalents are **forbidden at authoring time** — they are derived
by verification from an attestation, never accepted as input. This is the ledger's existing rule
and it applies unchanged.

A producer may write `promotionAuthorized: false`. It may never write `true`.

## Frozen: the gate must be red today

`src/lib/journey-contract-verify.mjs` gains a traversal check that walks the full chain and fails
when any stage is absent, when an `inputs` digest does not match the artifact it names, or when a
stage claims completeness it cannot show.

**On today's tree that gate must FAIL**, because four stages do not exist. A gate authored green
against a tree missing four fifths of its subject is the vacuous pass in its purest form. Probe
both directions: red on today's tree, green on a hand-built fixture chain of all five artifacts.

## Out of scope for this wave

Real deployment (no credentials), real audience observation (no users), and the quality of any
generated deck. This wave builds a chain that **runs and is checkable**, not a persuasive one.
