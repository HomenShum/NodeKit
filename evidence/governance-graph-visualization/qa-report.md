# Governance graph QA report

## Journey verdicts

| Journey | Verdict | Evidence |
| --- | --- | --- |
| A0 smoke | PASS | CLI writes parseable HTML and JSON |
| A1 core creation | PASS | PR #32 fixture derives a content-bound assessment and evidence pack |
| A2 live AI action | N/A | No model or network call exists on this surface |
| A3 provenance audit | PASS | Selecting a node changes the fixed inspector; JSON carries the same digest |
| A4 output and sharing | PASS | HTML and adjacent JSON are written |
| A5 themes and access | PASS | Desktop light/dark and mobile captures; keyboard-focusable nodes; no page overflow |
| A6 adversarial | PASS | Caller mode ignored; missing UI media rejected; timeout and rollback failures fail closed |
| A7 agentic depth | N/A | Static projection only; canonical state remains Caseflow |

## Visual bar

`B2–B8, B10–B11: 2/2`; `B9: 2/2` after direct desktop, dark, and mobile pixel review.
`B1` is not applicable because this visualization does not call a model.

## Mobbin reference trace

- n8n workflow builder: summary/canvas/inspector hierarchy
- StackAI knowledge graph: graph density and selected-node affordance
- GitHub mobile file view: responsive reduction and progressive disclosure

Only atomic observations and reference URLs are stored. Third-party pixels are not committed.
