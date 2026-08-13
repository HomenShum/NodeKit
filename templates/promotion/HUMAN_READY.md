# The HUMAN-READY gate

**Single source. Consuming repos link it; they never restate it.**

Raw: `https://raw.githubusercontent.com/HomenShum/NodeKit/main/templates/promotion/HUMAN_READY.md`

## The human situation this protects

A new engineer clones the repository on their first day. Nobody who built it is
available. They need to run it, follow one real user action all the way through
the code, change something, and know which test proves they did not break it. The
failure this prevents is the codebase only its author can navigate — where the
path from a button to a database write is spread across six indirections that made
sense during construction and nowhere else.

[The PROMOTION gate](GATE.md) asks *can a stranger use this product.* This one asks
*can a stranger maintain it.* The end state is both:

> **REAL_USER_READY AND HUMAN_CODEBASE_READY**

## The loop

    PRODUCT CONVERGENCE -> BEHAVIOR LOCK -> CODEBASE REDUCTION
      -> CODEBASE HUMANIZATION -> ORDERED WALKTHROUGH
      -> COLD-READER VERIFICATION -> HUMAN-READY PASS

Order matters and is not negotiable: **stabilize the user experience before
repo-wide cleanup**, and **delete before creating abstractions**. Refactoring a
surface that is still changing is wasted work, and an abstraction introduced before
the deletions is an abstraction over code that should not exist.

**The optimization target is not raw line count.** Judge by concepts removed:
dependencies, public APIs, config knobs, indirections, files a reader must open.
Denser code that hides the same complexity has made things worse.

## Refactoring rules

1. Preserve externally observable behavior unless an existing behavior is *proven*
   to be a defect.
2. Add characterization or end-to-end tests *before* refactoring an important path
   that lacks protection.
3. Do not combine feature work and structural refactoring in one change unless they
   cannot be separated safely.
4. Prefer deletion over replacement.
5. Before writing any code, apply the **reuse ladder** and stop at the first rung
   that holds:
   - a. Is the behavior needed at all?
   - b. Does this repository already contain it?
   - c. Does the standard library provide it?
   - d. Does the browser, framework, database, or hosting platform provide it?
   - e. Does an already-installed dependency provide it?
   - f. Would one mature dependency remove substantially more custom code than it
     adds?

## The deliverable packet — deliberately small

    README.md
    docs/
    ├── START_HERE.md
    ├── SIMPLIFICATION_REPORT.md
    └── codebase/
        ├── STACK.md
        ├── STRUCTURE.md
        ├── ARCHITECTURE.md
        ├── CONVENTIONS.md
        ├── INTEGRATIONS.md
        ├── TESTING.md
        └── CONCERNS.md
    .tours/
    ├── 01-primary-user-flow.tour
    ├── 02-agent-execution.tour
    └── 03-debug-and-recovery.tour

**Do not add Docusaurus, Nextra, or a custom documentation app.** Markdown plus
validated CodeTours is enough until an external documentation website is a real
product requirement. Storybook only where the project already uses it — never
introduced just to create another documentation surface.

## START_HERE.md is in runtime order, not architecture order

Not another architecture essay. Present the code in the order it executes, one step
per stage, using this exact format:

    ## Step 4 — The validated request enters agent orchestration

    **File:** `src/features/review/run-review.ts`
    **Symbol:** `runReview`
    **Called by:** `submitReviewAction`
    **Calls next:** `executeReviewPlan`

    **Why this exists**
    This is the application boundary between a validated user request and the
    agent runtime. UI state is not allowed below this boundary.

    **Core code**
    ```ts
    export async function runReview(input: ReviewInput, context: RunContext) {
      const plan = await createReviewPlan(input, context);
      return executeReviewPlan(plan, context);
    }
    ```

    **Input** — a validated ReviewInput and authenticated execution context.
    **Output** — a streamed review run with persisted evidence receipts.
    **Failure behavior** — planning failures become `review.plan_failed`; no
    artifact mutation has occurred at this point.
    **Next** — continue to `executeReviewPlan` in Step 5.

Required reading order:

1. application entry and route
2. primary user action
3. validation and domain types
4. agent orchestration
5. tool registration and invocation
6. persistence or artifact mutation
7. streaming and rendering
8. failure and recovery
9. tests proving the flow

**Keep copied snippets short.** The CodeTour is the canonical interactive
walkthrough because it points into current source; long copied snippets go stale
the moment the file moves.

## SIMPLIFICATION_REPORT.md is evidence, not adjectives

| Measure | Before | After | Change | Evidence command |
|---|---:|---:|---:|---|
| Production files | | | | |
| Production source lines | | | | |
| Direct dependencies | | | | |
| Unused files | | | | Knip |
| Unused exports | | | | Knip |
| Duplicate blocks | | | | jscpd |
| Duplicate percentage | | | | jscpd |
| Circular dependencies | | | | dependency-cruiser |
| Canonical workflow tests | | | | project test command |
| Browser workflow passes | | | | Playwright |
| Production bundle size | | | | existing build analyzer |
| Additions/deletions | | | | git diff |

Also record: what was deleted; which custom implementations were replaced by an
existing capability; and every finding left unresolved, with the reason.

A row with no evidence command is not a measurement. Where a tool does not support
the stack, say so in the row rather than leaving it blank.

## The gate

- Responsive and accessibility behavior has not regressed.
- Build, typecheck, tests, and browser checks pass.
- No unexplained critical runtime error remains.
- No material unused-code finding remains unexplained.
- Every material duplicate finding is resolved or intentionally documented.
- No forbidden or unintended dependency cycle remains.
- No substantial custom implementation remains where an existing repository,
  native, standard-library, platform, or installed-package capability is clearly
  sufficient.
- Primary workflows have one discoverable code path.
- Source code uses clear domain naming.
- Important boundaries and invariants are visible.
- Setup works from a clean checkout.
- The ordered walkthrough matches the current commit.
- CodeTours validate.
- The simplification report is reproducible.
- The fresh cold reader can run, trace, explain, modify, and verify the application
  without private context.
- No known P0 or P1 remains.

If any gate fails, report **HUMAN_READY: BLOCKED**, name the highest-impact
reproducible failure, repair it, and rerun the relevant verification.

## The final independent test — the cold reader

**The strongest gate is not the same coding agent declaring that its own work is
understandable.** Use a fresh session with no conversation memory, or a new
engineer. Give them only the repository, and ask them to run the application and
then show, in order:

1. where the primary user action begins
2. where input becomes trusted
3. where the agent execution starts
4. where tools are registered and called
5. where state or artifacts are mutated
6. how progress reaches the interface
7. how failures and retries work
8. which tests prove this
9. where they would add one adjacent capability

A cold reader who cannot answer these from the repository alone has found the
defect, whatever the documentation claims.

## Stop rule

Stop when the remaining changes are subjective style preferences, speculative
abstractions, or low-value code compression. Not before, and not after.
