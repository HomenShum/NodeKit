# The ASSERTION DISCIPLINE gate

Recorded from the Cheiron take-home biology layer, 2026-08-11
(MEASUREMENTS #80 and #81; NodeGraph trust grammar).

## The human situation first

A system that measures things (counts, latencies, totals) eventually wants
to also SAY things it read from a curated database: "this protein
participates in this pathway", "this term means this concept." A reader
repeats that statement in a meeting. Unlike a measurement, the statement
came from a database release that changes quarterly — and if the system
mixed releases, invented the connection from two other connections, or
turned a dead endpoint into "nothing to report", the reader is now
defending a claim with no source behind it.

**Paper note: a database's claim needs the same manners as a measured
number — a named version, a link that re-returns it, and a loud failure —
and it must never be dressed to look like a measurement.**

## What the gate requires

1. **Every assertion carries its corpus and its receipt.** The versioned
   release it came from (`reactome-v97`-shaped tag) plus the literal request
   that re-returns it. Replay for an assertion is re-issuing that request
   against the pinned release.
2. **Release drift refuses.** A client pinned to release N refuses to serve
   release N+1 rather than quietly mixing corpora — the "as of" guarantee,
   transposed from counts to claims.
3. **Failure is loud, never empty.** For a citation-style extra, degrading
   to nothing is honest. For an assertion source it is a lie: an empty list
   must mean "the source states nothing here", never "the fetch died."
   Junk input is refused before it becomes a URL; reads are bounded.
4. **A chain is not a statement about its endpoints.** A→B from one source
   plus B→C from another never renders A→C. Only a DIRECT assertion for a
   pair may be shown for that pair, direction-exact.
5. **Check the source you already trust before adding a vendor.** The first
   identity need was solved by the primary data source's own curated
   annotations (exact-match only — synonym luck was separately measured at
   a 24% distortion), not by a new ontology service.
6. **Transposing a discipline is not copying its code.** What carries over
   is the invariant (named corpus, replayable receipt, loud failure). What
   must be re-derived per source is everything the wire actually does — the
   reference source's version endpoint 406'd a JSON Accept header and 403'd
   clients without a User-Agent on first contact.

## The rendering half: three trust classes, never confusable

A reader must be able to tell at a glance which kind of thing a graph edge
or badge is, because the three kinds carry different obligations:

| Class | What it is | Visual contract |
|---|---|---|
| Measurement | a number the system probed this session | full ink; magnitude may ride width |
| Curated assertion | a versioned source's claim | distinct accent; release tag disclosed on selection; NEVER the measurement style |
| Interaction telemetry | what the user/agent touched | faint, constant width; explicitly labeled "not evidence" |

Two further rules from the same lineage: motion animates only while an
ingestion is actually happening and never encodes magnitude ("the system
did this", not "the system is thinking"); and positions are layout, never
meaning — draggable without semantic effect, with no layout field present
on any model that carries a claim (enforceable as a schema test). The
extracted `NodeGraph` component implements this grammar.

## When it runs

At the exit of any stage that introduces a second kind of truth: a curated
database, an ontology, a knowledge base, a "the docs say" surface — or that
renders such claims next to measured ones.
