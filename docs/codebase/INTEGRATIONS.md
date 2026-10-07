# INTEGRATIONS

Everything this repository talks to that is not itself, and what happens when that
thing is unavailable.

## The short version

**Nothing is required.** A clean checkout with `npm ci` runs the whole default
suite with no database, no API key, no network, and no browser. Every integration
below is opt-in, and every one of them degrades to a recorded skip rather than a
silent pass.

## Databases

| Backend | Where | How it is reached | Without it |
|---|---|---|---|
| In-memory | `src/lib/caseflow.mjs` `createMemoryCaseflow` | plain `Map`s in the process | this is the default; nothing to configure |
| Postgres | `src/adapters/postgres-caseflow.mjs`, schema in `adapters/postgres/001_caseflow.sql` | `pg`, connection string from the environment | `npm run conformance:postgres` is not run; the default suite is unaffected |
| Supabase | `adapters/supabase/001_profile.sql`, `002_workers.sql` | `npm run conformance:supabase-local` against a local Supabase | same |
| Convex | `src/component/`, compiled to `dist/` | an **optional peer** dependency | nothing in the default path imports `convex` |

The Postgres adapter is not a second implementation that hopes to match. It is
verified by running the same conformance suite against both backends and diffing —
`test/conformance.test.mjs`, and `src/lib/caseflow-conformance.mjs` is the suite
itself. `docs/BACKEND_PORTABILITY.md` has the detail.

## Model Context Protocol (outbound: agents call us)

`nodekit atlas serve --mcp` starts a stdio JSON-RPC server so a coding agent can
search this repository's design assets.

- Tools are declared in `ATLAS_MCP_TOOLS`, `src/lib/atlas-mcp.mjs` line 34.
- Dispatch is `handleAtlasRpc`, line 123 — `initialize`, `tools/list`, `tools/call`.
- A failing tool returns `{ isError: true }` with the message as text. The server
  does not exit; the agent reads the error and retries.

## Browser (Playwright)

Used only to *capture evidence*, never in a code path a user reaches.

- `scripts/run-protected-browser-lane.mjs` drives the generated application across
  6 viewports and 2 themes.
- `scripts/ui-gates/trust-surface-selftest.mjs` (`npm run gate:trust-surface`) runs
  against a fixture and needs no browser.
- `scripts/ui-gates/trust-surface-live.mjs` runs the same checks against a live URL
  and does need one.
- `scripts/ui-gates/playwright-peer.mjs` resolves Playwright as an optional peer, so
  a checkout without browsers installed reports "not run" rather than crashing.

Accessibility assertions use `@axe-core/playwright`.

## Package registry (npm)

Several proofs verify that what would be *published* is what was tested, by packing
a tarball and inspecting its bytes:

- `src/lib/npm-package-archive.mjs` parses the tarball itself — gzip, tar headers,
  PAX records, checksums — rather than shelling out to `tar`. That is a deliberate
  trust-boundary decision: the archive is untrusted input, and the parser refuses
  path traversal, symlinks, sparse files, and duplicate entries.
- `npm run proof:package-install` (`scripts/run-package-install-proof.mjs`) installs
  the packed tarball into a scratch project and runs it.

## Git

`nodekit create` initialises a repository by default and records the resulting
commit, because a receipt binds to an immutable commit. `--no-git` is allowed;
`--local-proof --no-git` is refused in `runCreate`, since there would be nothing to
bind to.

## Continuous integration

| Workflow | Trigger | What it protects |
|---|---|---|
| `.github/workflows/quality.yml` | push to `main`, PR | tests, typecheck, production audit |
| `.github/workflows/evolution.yml` | push to `main`, PR | a material change carries a reviewed ledger entry |
| `.github/workflows/ease-proof.yml` | PR, manual dispatch | cold/warm install timing on a real runner, with paired-run validation |
| `.github/workflows/ecosystem.yml` | weekly cron, manual | cross-repository conformance |
| `.github/workflows/repo-conformance.yml` | called by the others | the reusable conformance job |

## Recorded third-party findings

`integrations/ajv.yaml` is a written record of what was verified about Ajv at a
specific version: that draft-2020-12 needs the `Ajv2020` class (it does, and
`src/lib/schema-validation.mjs` line 24 uses it), and that `strict: false` is set,
which means unknown keywords and unrecognised formats pass unreported.

That file is documentation, not a validated artifact — nothing in the test suite
reads it. See CONCERNS.md.
