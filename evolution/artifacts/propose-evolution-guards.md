# propose-evolution.mjs — authority guards, adversarially tested

Captured 2026-07-25, corrected 2026-07-25 after the first capture failed to reproduce.
Reproduce with `node scripts/probe-propose-guards.mjs` — it exits non-zero if any guard stops
holding, or if an attack stops reaching the guard it aims at.

## THE FIRST CAPTURE WAS WRONG, AND WRONG IN AN INSTRUCTIVE WAY

Four guards were recorded as tested. Three of the four commands never reached the guard they named.
`propose-evolution.mjs` validates required arguments before it checks kebab-case, materiality, or an
existing draft, so a command missing `--challenge` dies in the argument parser:

    recorded  propose-evolution.mjs --materiality made-up
              -> "unknown materiality made-up"    exit=2
    actual    propose-evolution.mjs --materiality made-up
              -> "--id is required"               exit=2

The exit code matched. The cause did not. That is the whole failure: a probe reading only the number
cannot tell a guard that fired from an argument parser that refused to start, and the matching
number made the record look confirmed. Same shape as the recall defect in this ledger — full
coverage reported, nothing actually searched.

The guards themselves were never broken. The evidence about them was.

## WHAT ACTUALLY HAPPENS

Each case below supplies a complete, otherwise-valid argument set so exactly one thing is wrong, and
asserts on the message as well as the exit code.

    G1  --status human-reviewed                    (self-approval)
        refused: this tool cannot write interpretation.status=human-reviewed.
        canonicalRecords is human-reviewed-only. A human promotes by moving the
        file into evolution/events/<track>/ and editing that field.
        exit=5

    G2  --id "Not_Kebab Case"                      (malformed id)
        --id must be kebab-case
        exit=2

    G3  --id copy-as-proof-surface                 (overwrite an existing draft)
        draft evt-copy-as-proof-surface.json already exists. delete is
        prohibited; use a new id and --supersedes evt:copy-as-proof-surface
        exit=4

    G4  --materiality made-up                      (invent a materiality value)
        unknown materiality made-up; ledger allows: primary-user-workflow,
        public-contract, architecture, ...
        exit=2

    G5  --track not-a-track                        (invent a track)
        --track must be one of harness, architecture, product
        exit=2

    G6  --id "../events/harness/pwned"             (escape the drafts lane)
        --id must be kebab-case
        exit=2
        NOTE: kebab-case rejects the slash before the path-containment check can
        run. Both guards exist; only the first fires. Recorded as what happened
        rather than as the containment guard, which this attack never reaches.

## RESULT: guards hold, tool output does not validate

6/6 guards hold and were reached. The probe leaves no draft behind; it checks.

Unchanged from the first capture, and still true: the records this tool produces do NOT validate
against `schemas/nodekit.evolution-event.v1.schema.json` — 7, 9 and 8 errors respectively. The tool
reverse-engineered the record shape from one example file instead of calling `draftEvolutionEvent()`.
Root fields were invented (materiality), categories were invented (governance, tooling),
`evidenceIds` was left empty where the schema requires at least one, and `interpretation` carried
invented properties.

The correct lane is NodeKit's own `draftEvolutionEvent`, which validates and refuses. That is not
fixed here.
