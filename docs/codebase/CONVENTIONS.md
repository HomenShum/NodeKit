# CONVENTIONS

Patterns that are consistent across the codebase, each with a real example. Follow
these and your change will look like it belongs; ignore them and a reviewer will
ask you to redo it.

## Comments explain the failure, not the code

The house style is a header comment naming **the thing that went wrong** that made
the module necessary. Not "this module validates integration records" — what broke.

`src/lib/ui-lexicon.mjs` opens:

> "If a button says delete on one screen and remove on another, you have created
> friction. Users will never report this."

`scripts/test-files.mjs` opens with the measurement that forced the fast/slow
split — 236 seconds in one test while 61 other files finished.

When you add a module, write that paragraph first. If you cannot name the failure
it prevents, the module probably should not exist.

## Naming

| Kind | Convention | Example |
|---|---|---|
| Files | `kebab-case.mjs`, one concern per file | `src/lib/frontend-render-contract.mjs` |
| Exported functions | `camelCase`, verb first | `createProject`, `decideProposal`, `evaluateFrontendRenderContract` |
| Exported constants | `SCREAMING_SNAKE`, always `Object.freeze` | `CASEFLOW_SCHEMA_VERSIONS`, `ATLAS_MCP_TOOLS` |
| Schema versions | `nodekit.<thing>/v<n>` | `nodekit.receipt/v2` |
| Tests | `test/<module>.test.mjs` mirrors `src/lib/<module>.mjs` | `test/caseflow.test.mjs` |

There is no `utils.mjs`, no `helpers.mjs`, no `common.mjs`. A function lives in the
module that owns its concern.

## Errors

Throw `Error` with a sentence a user can act on. Attach `.code` when a caller needs
to branch, and subclass only when a whole family of failures shares handling
(`NpmPackageArchiveError` in `src/lib/npm-package-archive.mjs`).

```js
// src/lib/caseflow.mjs
throw new Error(`proposal retry does not match original decision request; proposal is already ${proposal.status}`);
```

Never call `process.exit` inside a command. Throw; the single handler at the bottom
of `src/cli-main.mjs` sets `process.exitCode`, which lets buffered stdout flush.

## Refuse rather than half-succeed

Validate at the top of the function, before any side effect. `runCreate` refuses
`--local-proof --no-git` before creating a directory, because a receipt must bind
to an immutable commit and there is no commit without a repository.

The related rule: an operation that would produce unverifiable evidence must refuse
rather than produce evidence with a caveat. Several modules export a `*Refusal`
error class for exactly this — `BuildEvidenceRefusal`, `StoryPackRefusal`,
`CapabilityContractRefusal`, `SessionContractRefusal`.

## Retries are idempotent, not "probably fine"

Any operation an agent might re-send takes an `idempotencyKey` or compares the
repeat against the original. `decideProposal` returns `reused: true` for an
identical retry and throws for a conflicting one. Neither silently overwrites.

## Immutable data crosses boundaries

Every exported constant is `Object.freeze`d. Every value returned from the caseflow
runtime goes through `clone()` first, so a caller cannot reach into internal state
by mutating what it was handed.

## Hashes are content hashes, and sorting is explicit

`contentHash` (`src/lib/caseflow.mjs` line 48) canonicalises before hashing.
Anywhere order could vary — object keys, event lists, file manifests — it is sorted
with an explicit comparator, never the default `.sort()`, because the default is
locale-dependent for strings. See `codeUnitCompare` in
`src/lib/npm-package-archive.mjs`.

## Async style

`async`/`await` throughout, and `node:fs/promises` rather than the callback API.
Explicit `.then()` appears 5 times in `src/`, all of them serialising work into a
queue rather than sequencing a result — `src/lib/atlas-mcp.mjs:179`,
`src/lib/workspace-reference-index.mjs:90`, and the two `Promise.resolve().then()`
timeout races in `src/lib/governance.mjs:100` and
`src/lib/native-agent-identity.mjs:244`. If you find yourself writing a sixth,
`await` is almost certainly what you want.

## Tests are scenarios, not method calls

A test names the situation and the failure it prevents:

```js
test("rejecting a proposal moves the run off the review stage", async () => { … });
test("negative checkpoint sequences fail closed instead of becoming a false latest checkpoint", () => { … });
```

`node:assert/strict` only. No test framework, no fixtures directory beyond
`test/fixtures/`, no mocking library — tests that need a server start a real one on
an OS-assigned port.

## Changing a test

Loosening an assertion is treated as guilty until its justification traces to a
specification or a measurement, and the old value stays in a comment beside the new
one. `promotion/PROMOTION_LOG.md` shows the expected shape of that justification.
`docs/ADVERSARIAL_GATE.md` is the rule.
