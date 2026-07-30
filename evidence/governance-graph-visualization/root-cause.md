# Root cause trace

1. The operator could not see the governance path because the execution graph was JSON and Markdown only.
2. It stayed machine-only because the graph compiler was designed as a disposable execution projection.
3. The deferred-review implementation did not provide a reusable UI projection because it encoded one narrow reversible-change lane.
4. That lane stayed narrow because architecture materiality and authority risk were not classified separately.
5. Without deterministic risk classification, a visual surface could only restate labels rather than explain why a gate exists.

The fix introduces deterministic effect/proof classification, typed receipts, and an HTML graph
generated from those receipts. The graph remains disposable and cannot promote its own candidate.
