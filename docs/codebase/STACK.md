# STACK

What this is built out of, and what each choice buys.

## Runtime

| Thing | Value | Where it is declared |
|---|---|---|
| Language | JavaScript, ES modules (`.mjs`) | `package.json` `"type": "module"` |
| Runtime | Node.js 20 or newer | `package.json` `"engines"` |
| Type checking | TypeScript, on hand-written `.d.mts` declarations only | `tsconfig.public.json` |
| Package name | `@homenshum/nodekit` | `package.json` |
| Binary | `nodekit` → `src/cli.mjs` | `package.json` `"bin"` |

There is **no build step for the JavaScript**. `src/**/*.mjs` is what ships and
what runs; `npm run build:component` compiles only the optional Convex component
under `src/component/` into `dist/`.

The `.d.mts` files next to the `.mjs` files are hand-written, not generated. That
is why `npm run typecheck:public` is meaningful: it checks that the declarations
still describe the JavaScript, rather than checking JavaScript against itself.

## Direct dependencies — four, in production

| Package | Version | Why it is here | What it replaced |
|---|---|---|---|
| `ajv` | 8.20.0 | Validates the 120 JSON Schemas in `schemas/` | a hand-written validator |
| `ajv-formats` | 3.0.1 | `date-time`, `uri` and friends for those schemas | — |
| `yaml` | ^2.9.0 | Parses `nodekit.yaml`, `ownership.yaml`, `harness.yaml` | — |
| `pngjs` | ^7.0.0 | Decodes browser screenshots so evidence can be checked, not just stored | — |

`convex` is an **optional peer** dependency. Nothing in the default path imports
it; the Convex component under `src/component/` is opt-in.

Dev dependencies (9) are the test and proof tooling: `vitest` and `convex-test`
for the component, `playwright` and `@axe-core/playwright` for browser evidence,
`pg` for the Postgres adapter conformance run, `typescript`, `@types/node`,
`@edge-runtime/vm`.

## What is deliberately absent

- **No bundler, no transpiler, no framework.** Node runs the source.
- **No test framework in the main suite.** `node --test` and `node:assert/strict`.
  `vitest` appears only for the Convex component, which needs a VM environment.
- **No ORM and no database in the default path.** `createMemoryCaseflow` in
  `src/lib/caseflow.mjs` is plain `Map`s. SQL is opt-in — see
  `adapters/postgres/001_caseflow.sql`.
- **No logger.** `console.log` for results, `console.error` for failures.
- **No argument-parsing library.** `parseArgs` in `src/cli-main.mjs` (line 130) and
  `node:util`'s own `parseArgs` where the shape fits.

That absence is the point rather than an oversight: the package is meant to be
vendored into a generated application, and every dependency it carries becomes a
dependency of every application it generates.

## Verify these numbers yourself

```bash
node -e "const p=require('./package.json');console.log(Object.keys(p.dependencies).length,'deps')"
ls schemas/*.json | wc -l          # 120
git ls-files src scripts | grep -v '\.test\.' | wc -l
```
