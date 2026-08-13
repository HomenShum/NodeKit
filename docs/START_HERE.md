# START HERE — one real action, traced in the order the code runs

This page is not an architecture essay. It follows a single command through the
codebase in **execution order**, one step per stage, so a new engineer can put a
breakpoint anywhere in the chain and know what came before it and what comes next.

The root [`START_HERE.md`](../START_HERE.md) orients you to *what this project is*.
This page tells you *where the code is*. Read that one first if the words below
feel unfamiliar; [`GLOSSARY.md`](../GLOSSARY.md) defines the project-specific ones.

## The human situation

Someone wants to build a small software product with the help of a coding agent.
Their problem is not writing code — the agent does that quickly. Their problem is
that the agent makes product decisions along the way, and the work comes back
technically fine and pointed at the wrong thing.

NodeKit's answer: **decide the boundary first, then require evidence that the
result matched it.** A person types one sentence about the job to be done, and
NodeKit writes out a complete working application whose runtime physically cannot
change the saved result without first proposing the change, getting it approved,
and recording a receipt that ties the approval to the exact bytes it approved.

The command that starts all of this:

```bash
node src/cli.mjs create ./my-app --brief "Track salon appointments"
```

Everything below is what happens when you press Enter, in order.

> **One thing to know before you read.** This repository is the *factory*, not the
> product. It generates applications. Some steps below therefore live in
> `templates/base/` — that is the source of the application that gets written out,
> and it is real, running code, not documentation.

---

## Step 1 — The command arrives and is routed

**File:** `src/cli.mjs`
**Symbol:** the module body (there is no function; the file is four lines)
**Called by:** the `nodekit` bin entry in `package.json`, or `node src/cli.mjs …`
**Calls next:** `src/cli-main.mjs`

**Why this exists**
Two command families live behind one binary. The `reference` family talks to an
external design provider and pulls in a heavier module graph; everything else does
not. Loading them both on every invocation would make the common case pay for the
rare one, so the public entry point is a four-line switch that imports exactly one
of them.

**Core code**
```js
const command = process.argv[2];
await import(command === "reference" ? "./reference-cli.mjs" : "./cli-main.mjs");
```

**Input** — `process.argv`, unparsed.
**Output** — nothing; the imported module runs its own `main()` as a side effect.
**Failure behavior** — an unknown command is not detected here. It falls through
to `cli-main.mjs`, which throws `unknown command: …` in Step 2.
**Next** — `main()` in `src/cli-main.mjs`, Step 2.

---

## Step 2 — Arguments are parsed and the command is dispatched

**File:** `src/cli-main.mjs`
**Symbol:** `parseArgs` (line 130), `main` (line 2235)
**Called by:** the top-level `await import` in Step 1
**Calls next:** `runCreate`

**Why this exists**
This is the whole command surface in one file: 109 dispatch branches
(`grep -c "if (first ===" src/cli-main.mjs`), each a flat `if` in `main()`. It is
one long function on purpose — a reader looking for
"where does `nodekit atlas search` go" finds it by searching one file rather than
by following a registry of handlers through three indirections.

**Core code**
```js
async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const [first, second] = parsed.positional;
  // …
  if (first === "create") {
    await runCreate(parsed);
    return;
  }
  // …
  throw new Error(`unknown command: ${parsed.positional.join(" ")}`);
}
```

**Input** — `process.argv` minus `node` and the script path.
**Output** — `parsed.positional` (the words) and `parsed.options` (the `--flags`).
**Failure behavior** — an unrecognised command reaches the final `throw`, which
the process-level handler in Step 8 turns into `nodekit: unknown command …` and
exit code 1. No files have been touched at this point.
**Next** — `runCreate` in the same file, Step 3.

---

## Step 3 — The primary user action: scaffold an application

**File:** `src/cli-main.mjs`
**Symbol:** `runCreate` (line 1105)
**Called by:** `main`
**Calls next:** `createProject` in `src/lib/scaffold.mjs`

**Why this exists**
This is the boundary between the command line and the factory. It turns loose
`--flags` into one options object and refuses combinations that cannot produce
valid evidence — notably `--local-proof` without Git, because a receipt has to be
bound to an immutable commit and there is no commit without a repository.

**Core code**
```js
async function runCreate(parsed) {
  const target = parsed.positional[1];
  if (!target) throw new Error("create requires a target directory");
  const localProof = parsed.options["local-proof"] === true || parsed.options["local-proof"] === "true";
  if (localProof && !optionEnabled(parsed.options, "git")) {
    throw new Error("--local-proof requires the default local Git candidate; …");
  }
  const result = await createProject({ /* backend, brief, git, install, name, target, … */ });
  const compiled = await compileAgentDefinition(result.target);
  // …
}
```

**Input** — the parsed argument object.
**Output** — a directory on disk, plus two lines on stdout: `CREATED …` and
`NEXT cd … && npm run compile && npm run demo`.
**Failure behavior** — every refusal here throws before any directory is created.
An incompatible flag combination cannot leave a half-written application behind.
**Next** — `createProject`, Step 4.

---

## Step 4 — Validation and the domain types

**File:** `src/lib/scaffold.mjs`, then `src/lib/agent-definition.mjs`
**Symbol:** `createProject` (scaffold.mjs line 315), then `compileAgentDefinition`
(agent-definition.mjs line 248)
**Called by:** `runCreate`
**Calls next:** `validateSchema` in `src/lib/schema-validation.mjs`

**Why this exists**
`createProject` copies `templates/base/` into the target and fills in the brief.
`compileAgentDefinition` then reads what was written back off disk and checks it
against the JSON Schemas in `schemas/`. That round trip is deliberate: the check
runs against the bytes that landed, not against the object that produced them, so
a template bug cannot pass validation by never being written down.

The domain vocabulary — Case, Run, Stage, Artifact, Proposal, Approval, Receipt —
is defined once, in `schemas/nodekit.*.schema.json`, and every layer agrees to it.
There are 120 of these files and they are the contract; the `.mjs` code is an
implementation of them.

**Core code**
```js
// src/lib/schema-validation.mjs
const ajv = new Ajv2020({ allErrors: true, strict: false, ...options });
```

**Input** — a repository root path.
**Output** — a resolved definition plus a `configHash`, written to
`.nodeagent/resolved-definition.json` in the generated application.
**Failure behavior** — a schema violation throws with the offending JSON pointer.
The directory exists at this point, so a failure here leaves a partially built
application; the recovery is to delete the directory and re-run.
**Next** — the generated application's own agent loop, Step 5.

> **Known loosening, recorded rather than hidden.** `strict: false` above means Ajv
> accepts unknown keywords and silently ignores unrecognised `format` values. A
> misspelled schema keyword will not be reported. See
> [`integrations/ajv.yaml`](../integrations/ajv.yaml).

---

## Step 5 — Agent orchestration inside the generated application

**File:** `templates/base/agent/workflow.mjs` (becomes `agent/workflow.mjs` in the
generated application)
**Symbol:** `createGuidedDemo` (line 10), `propose` (line 29), `decide` (line 44)
**Called by:** the generated `scripts/demo.mjs` and `apps/web/server.mjs`
**Calls next:** `createMemoryCaseflow` in `src/lib/caseflow.mjs`

**Why this exists**
This is the shape every generated application starts from: four named stages, and
an agent that may *propose* a change but may not apply one. The interesting line is
`propose` — the agent writes a proposal against a specific `baseVersion` of the
artifact, and that version number is what makes a stale proposal detectable later.

**Core code**
```js
export const stages = Object.freeze([
  { id: "intake",   label: "Confirm the intended outcome", owner: "user" },
  { id: "working",  label: "Prepare a proposal",           owner: "agent" },
  { id: "review",   label: "Review the proposed change",   owner: "user" },
  { id: "complete", label: "Verify and export",            owner: "system" },
]);
```

**Input** — a case title and the primary job, taken from the brief.
**Output** — a pending proposal and a run parked on the `review` stage.
**Failure behavior** — the agent cannot fail into a mutation. Every path out of
`propose` either produces a proposal or throws; neither changes the saved artifact.
**Next** — either an MCP tool call (Step 6) or a human decision (Step 7).

---

## Step 6 — Tool registration and invocation

**File:** `src/lib/atlas-mcp.mjs`
**Symbol:** `ATLAS_MCP_TOOLS` (line 34), `callAtlasTool` (line 77),
`handleAtlasRpc` (line 123)
**Called by:** `nodekit atlas serve --mcp`, which a coding agent connects to
**Calls next:** the retrieval functions in `src/lib/atlas-retrieval.mjs`

**Why this exists**
A coding agent working on a generated application needs to look things up —
registered design assets, interaction flows, the recipe that rebuilds a component.
Rather than let it read the whole index (which would flood its context), the tools
are laid out in rungs: rung 1 returns ranked candidates with no code, and only a
later rung returns the source. The rung is stated in each tool's own description.

**Core code**
```js
export const ATLAS_MCP_TOOLS = Object.freeze([
  {
    name: "search_assets",
    description: "RUNG 1. Compact ranked asset candidates. Hard-constraint filters run before scoring; …",
    inputSchema: { type: "object", required: ["terms"], properties: { terms: { type: "string" }, …} },
  },
  // …
]);
```

**Input** — a JSON-RPC message on stdin (`initialize`, `tools/list`, `tools/call`).
**Output** — a JSON-RPC result. `tools/list` returns the frozen array above.
**Failure behavior** — a failing tool returns `{ isError: true }` with the message
as text, rather than crashing the server. The agent sees the error and can retry.
**Next** — persistence, Step 7.

---

## Step 7 — Persistence: the one place an artifact changes

**File:** `src/lib/caseflow.mjs`
**Symbol:** `decideProposal` (line 289), `completeRun` (line 504)
**Called by:** the generated application's `decide` (Step 5) and `/api/decide`
**Calls next:** `contentHash` (line 48), then the receipt writer inside `completeRun`

**Why this exists**
This is the invariant the whole product rests on. **A saved artifact changes in
exactly one function, and only when an approval names the version it was written
against.** If the artifact moved on since the proposal was made, the proposal is
marked `conflicted` and nothing is applied — the stale change is contained rather
than silently overwriting newer work.

**Core code**
```js
if (decision === "accepted" && proposal.baseVersion !== artifact.canonicalVersion) {
  proposal.status = "conflicted";
  emit("proposal", proposalId, "proposal.conflicted", { canonicalVersion: artifact.canonicalVersion }, eventActor);
  return { approval: clone(approval), artifact: clone(artifact), proposal: clone(proposal), reused: false };
}
```

**Input** — a proposal id and `"accepted"` or `"rejected"`.
**Output** — an approval record; on acceptance, `artifact.canonicalVersion` is
incremented and a `receipt` whose `receiptHash` is a content hash of the run body.
**Failure behavior** — a repeated decision that matches the original returns the
first result with `reused: true` (idempotent retry). A repeated decision that
*differs* throws rather than overwriting the first one.
**Next** — showing the result, Step 8.

---

## Step 8 — Rendering: the interface shows the outcome, not the request

**File:** `templates/base/apps/web/server.mjs`
**Symbol:** `setPresentation` (line 41), and the decision route that follows it
**Called by:** the browser, over HTTP
**Calls next:** `templates/base/apps/web/public/app.js`, which paints the state

**Why this exists**
A defect shipped here once and is worth knowing about: the interface used to show
what the user *asked for* rather than what the runtime *did*. Approving a stale
proposal displayed "Completion verified" while the runtime had actually contained a
conflict. The fix is the rule in the comment below — presentation is a function of
the status the runtime returned, never of the decision that was requested.

**Core code**
```js
// Every decision routes through here, and the presentation is a function of the status the runtime
// returned …
if (proposal.status === "accepted") setPresentation("completed_receipt", "complete", "Completion verified", …);
else if (proposal.status === "rejected") setPresentation("proposal_rejected", "decision", "Proposal rejected", …);
else setPresentation("conflict", "conflict", "Conflict contained", …);
```

**Input** — the object returned by `decideProposal` in Step 7.
**Output** — a presentation id and copy, sent to the browser as JSON.
**Failure behavior** — there is no fall-through branch. An unrecognised status
lands in the `else`, which is the conflict presentation — the conservative choice,
because it tells the user their change was *not* applied.
**Next** — failure and recovery, Step 9.

---

## Step 9 — Failure and recovery

**File:** `src/cli-main.mjs` (line 2908) and `src/lib/caseflow.mjs` (line 289)
**Symbol:** the top-level `main().catch`, and the `reused` return path
**Called by:** the Node process, and any client that retries
**Calls next:** nothing — these are the ends of the chain

**Why this exists**
Two different failure shapes, handled in two different places. A *command* failure
is a message and a non-zero exit code; there is no stack trace, because the person
reading it is a user, not a debugger. A *retry* is not a failure at all: an agent
or a flaky network will re-send the same decision, and re-sending must not create a
second approval.

**Core code**
```js
main().catch((error) => {
  console.error(`nodekit: ${error.message}`);
  process.exitCode = error?.exitCode ?? 1;
});
```

**Input** — any thrown error from any command.
**Output** — one line on stderr, exit code 1 (or a command-specific code).
**Failure behavior** — this *is* the failure behavior. Nothing above it is allowed
to call `process.exit` directly, so buffered stdout still flushes.
**Next** — the tests, Step 10.

---

## Step 10 — The tests that prove this flow

**File:** `test/factory.test.mjs`, `test/generated-project-gates.test.mjs`,
`test/caseflow.test.mjs`
**Symbol:** see the named tests below
**Called by:** `npm test`
**Calls next:** nothing

**Why this exists**
Each step above has one test that would fail if that step broke. These are the
three to run first when something is wrong:

| If you changed… | Run | What it proves |
|---|---|---|
| Steps 3–4 (scaffolding) | `node --test test/factory.test.mjs` | `nodekit create` produces a directory that compiles and validates |
| Steps 5, 8 (generated app) | `node --test test/generated-project-gates.test.mjs` | the generated server is started on a real port and all three outcomes are asserted over real HTTP — including `"rejecting a proposal moves the run off the review stage"` and `"the generated server presents the outcome achieved, not the decision requested"` |
| Step 7 (persistence) | `node --test test/caseflow.test.mjs` | the runtime passes the provider-neutral conformance suite, so the in-memory and Postgres backends agree |

**Input** — none; the tests build their own fixtures.
**Output** — TAP on stdout. `npm test` runs 838 of these plus 8 Convex component
tests.
**Failure behavior** — `npm test` exits non-zero. Two of these tests compare a
*generated* index (`repo-map.json`, `behavior-index.json`) against the source and
tell you to run `npm run repo:map` / `npm run behavior:index`. That is not a broken
test; it means you added or removed a module and the committed map is stale.
**Next** — nothing. That is the whole chain.

---

## Where the stages you might expect are, if they are not above

- **There is no login, session, or multi-tenant request path.** This is a CLI and a
  library. The generated application's web server binds to localhost and has no
  authentication. Do not deploy it as-is.
- **There is no streaming.** Progress reaches the user as ordinary stdout lines and
  ordinary HTTP responses. There is no SSE or WebSocket anywhere in `src/`.
- **There is no ORM or migration runner in the default path.** The default runtime
  is `createMemoryCaseflow` — plain `Map`s. SQL adapters exist under `adapters/`
  and are opt-in; `docs/BACKEND_PORTABILITY.md` covers them.

## Next

- Follow the same path interactively: the `.tours/` CodeTour files open in VS Code
  with the [CodeTour extension](https://marketplace.visualstudio.com/items?itemName=vsls-contrib.codetour)
  and step through live source rather than the copies above.
- `docs/codebase/STRUCTURE.md` — what each top-level directory is for.
- `docs/codebase/CONCERNS.md` — what is known to be wrong, with the command that
  reproduces each one.
