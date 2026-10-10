# Changelog - public package documentation

> **Surface**: Documentation guaranteed to be present in an installed `@homenshum/nodekit` package.
>
> **Append rule**: New entries go at the top and released entries are never rewritten.

## 2026-10-05 - Pin the graph guide to its reviewed source recipe

Link the packaged execution-graph guide to the exact source commit containing the portable host
acceptance requirements. Readers can inspect the same reviewed recipe without following a moving
branch. The recipe remains outside the npm package; packaged file selection and runtime exports are unchanged.

**Commit**: `this commit`. **Author**: Codex.
**Touches**: `docs/EXECUTION_GRAPH_OF_LOOPS.md`

## 2026-08-02 - Pack the idea-to-reality manual

Include `docs/IDEA_TO_REALITY_PRINCIPLES.md` in the npm package so README and START_HERE links remain
usable outside the source checkout. The package-link gate and dry-run tarball both verify the
distribution boundary.

**Commit**: `this commit`. **Author**: Codex.
**Touches**: `CHANGELOG/docs/onboarding.md`
