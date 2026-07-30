# Before / after proof

## Intended goal

Make NodeKit's governance decision understandable at a glance while replacing blanket immediate
human approval with risk-derived modes, exact proof, observation, and verified rollback.

## Before

- `node src/cli.mjs governance visualize --scenario pr32 --out .tmp/governance-graph.html`
  exited `1` with `nodekit: unknown command: governance visualize`.
- No typed governance receipt schemas existed.
- There was no graph, inspector, or UI evidence surface for the decision path.

## After

- The same command exits `0`, reports
  `GOVERNANCE AUTO_PROMOTE_WITH_ROLLBACK ready=true`, and writes HTML plus JSON.
- Five versioned receipt schemas validate the decision and proof boundary.
- The generated route contains nine graph nodes, a fixed inspector, three reference-provenance
  links, light/dark rendering, and a horizontally scrollable mobile canvas without page overflow.

## Evidence

- `before/cli.txt`
- `after/cli-final.txt`
- `after/dom-verification.json`
- `after/desktop-light.png`
- `after/desktop-dark.png`
- `after/mobile-light.png`
- `after/repository-tests-final.txt`

## Unchanged

- Caseflow remains canonical.
- The graph is a disposable explanation and cannot grant promotion authority.
- No backend, production deployment, or external mutation is exercised by this deterministic
  package fixture.
