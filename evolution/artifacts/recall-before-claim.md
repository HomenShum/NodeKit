# recall.mjs — before/after coverage

Captured 2026-07-25 on Windows, Node 22.22.2.

## BEFORE — the probe that produced eight false absents

    $ cd "D:/VSCode Projects" && ls -d */node-platform
    exit=0 matches=0

Zero matches, exit code zero, no output. node-platform sits at depth 2; the glob
covered depth 1. Nothing in that result distinguishes "absent" from "not looked for".

## AFTER — scripts/recall.mjs "copy as proof surface"

    ENGINEERING HALF (5)
      evolution/drafts/evt-copy-as-proof-surface.json
      evolution/events/harness/evt-copy-as-proof-surface.json
      evolution/evidence/evd-copy-as-proof-surface.json
      evolution/invariants/inv-copy-claims-gate-lies-not-taste.json
      evolution/projections/EVOLUTION.md:223
    COVERAGE — 9 roots, 384 files read, 0 missing
    FOUND 5 across 384 files.

## SELF-CAUGHT DEFECT, first execution

    COVERAGE
      repositories   MISSING ROOT  D:\VSCode%20Projects\...\repositories.yaml
      ... 7 roots MISSING
    NO MATCH in 268 files across 9 roots.
    This is NOT a claim that it does not exist.
    7 root(s) were missing entirely - absence is unprovable.

import.meta.url percent-encoded the space in "VSCode Projects", so every
engineering root resolved to a non-existent path. The tool reported incomplete
coverage instead of "not found". Fixed with fileURLToPath.

## CONTROL — a term that genuinely does not exist

    $ node scripts/recall.mjs "zzq-nonexistent-widget"
    NO MATCH in 384 files across 9 roots.
    This is NOT a claim that it does not exist.

No missing roots, no unreadable files, and it still refuses to assert absence.

### THIS CONTROL DESTROYED ITSELF

Re-run 2026-07-25 after this artifact was committed:

    $ node scripts/recall.mjs "zzq-nonexistent-widget"
    FOUND 1 across 4373 files.
      evolution/artifacts/recall-before-claim.md

The single hit is the line above. `evolution/` is a registered root, so writing
down "this term does not exist" put the term into the corpus and the control
stopped being a control. Nothing regressed in the tool; the experiment consumed
its own premise.

A written-down control is a one-shot. A durable one must be generated at run
time and never persisted — a random token per run, checked for NO MATCH, and
discarded. Until that exists, treat any control term appearing in this
repository as already spent, and do not read a later FOUND on it as a defect.

The general property, since it bit twice in one session: **this tool indexes the
repository that documents this tool.** Any count, any absence, and any example
written here changes what a later run of the same query returns.

## BOUNDARY

Proves what was read. Does not and cannot prove a thing does not exist.
Substring matching only: a decision recorded in different words is not found.
