# propose-evolution.mjs — authority guards, adversarially tested

Captured 2026-07-25. Each guard was attacked before any real record was written.

    G1  --status human-reviewed  (self-approval)
        ERROR refused: this tool cannot write interpretation.status=human-reviewed.
        exit=5

    G2  --id "../events/harness/pwned"  (escape the drafts lane)
        ERROR --id must be kebab-case
        exit=2

    G3  --id copy-as-proof-surface  (overwrite an existing draft)
        ERROR draft evt-copy-as-proof-surface.json already exists.
              delete is prohibited; use a new id and --supersedes
        exit=4

    G4  --materiality made-up  (invent a materiality value)
        ERROR unknown materiality made-up; ledger allows: primary-user-workflow, ...
        exit=2

## RESULT: partial

The guards hold. The records this tool produced did NOT validate against
schemas/nodekit.evolution-event.v1.schema.json — 7, 9 and 8 errors respectively,
because the tool reverse-engineered the shape from one example file instead of
calling draftEvolutionEvent(). Root fields were invented (materiality),
categories were invented (governance, tooling), evidenceIds was left empty where
the schema requires at least one, and interpretation carried invented properties.

The correct lane is NodeKit's draftEvolutionEvent, which validates and refuses.
