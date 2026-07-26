# brain.db — read-only guarantee and ranking

Captured 2026-07-25.

## READ-ONLY IS STRUCTURAL, NOT CONVENTIONAL

    $ python -c "sqlite3.connect('file:brain.db?mode=ro', uri=True) ... INSERT"
      write correctly refused: attempt to write a readonly database

Refresh does not mutate the store it reports on:

    md5 before refresh  bed272366dbb663ef8be43489a7d6fd0
    md5 after  refresh  bed272366dbb663ef8be43489a7d6fd0

## RANKING — cost of delay, cash speed as tie-break

    1. Casca screening call            due in 2d
    2. Day-14 cash bridge gate         due in 3d
    3. Barnaby de Hoedt - Realm Group  warm inbound, unanswered 0d
    ...
    12. first role (application)

All nine warm leads outrank all twenty-eight applications, by construction.

## HONEST STALENESS

An earlier version measured staleness from node creation, so every lead reported
"0d" on the day it was imported — demoting the most urgent items while looking
authoritative. It now returns unknown and sorts unknown as urgent:

    Robert Chandler - Wordware   warm inbound, waiting an unknown time

## BOUNDARY

Eleven leads and obligations are real. Arrival dates for five were read from
LinkedIn; one (Chandler) remains unverified and is marked so. The store lives
outside this repository and is not covered by repositories.yaml.
