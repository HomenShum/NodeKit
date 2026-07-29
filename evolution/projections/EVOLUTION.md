# NodeKit Evolution Ledger

Canonical JSON records remain authoritative. This projection explains why material system guarantees exist.

## Product evolution

### The primary initializer silently specialized the product.

- Event: `evt:domain-blank-factory`
- Source: `8d4f7e6e8235751d07c456208f841b15edf8de39`
- Resolution: NodeKit now exposes one domain-blank factory and keeps narrow applications as references.
- Observed failure: A blank creation command selected a reference workflow without user authority.
- Invariants: `inv:domain-blank-create` (verified)
- Evidence: `evd:domain-blank-factory` (pass)
- Known limitations: Reference applications still require explicit user selection after creation.

### The natural named-option form for selecting a submission candidate failed before evidence evaluation began.

- Event: `evt:submission-cli-named-options`
- Source: `d0d9bb5b0a2cde1cdc2b236025ac985595613a5d`
- Resolution: Submission preparation and evaluation now accept explicit named options, retain positional compatibility, reject unknown options clearly, and have subprocess coverage for the public command form.
- Observed failure: npm run submission:prepare -- --candidate <sha> treated --candidate as a literal Git reference and produced a spawn error instead of a readiness manifest.
- Invariants: `inv:submission-cli-explicit-options` (verified)
- Evidence: `evd:submission-cli-explicit-options` (pass)
- Known limitations: A generated readiness manifest remains fail-closed until every external evidence gate passes.; This change improves command usability but does not authorize publication or Convex submission.

### A generated app could display guided intake and review controls without actually enforcing the intake transition or making the current decision usable in the initial mobile viewport.

- Event: `evt:guided-intake-mobile-decisions`
- Source: `4407b70c616c89b022e0d3d36ba02f00519b1688`
- Resolution: The human-reviewed product contract requires explicit outcome confirmation before proposal creation, persisted progression into active work, proposal absence during intake, and one state-appropriate mobile decision surface inside the initial viewport.
- Observed failure: DOM presence alone could pass while a premature proposal was accepted or the only meaningful mobile action began below the fold.
- Invariants: `inv:guided-intake-mobile-decisions` (partially-verified)
- Evidence: `evd:guided-intake-mobile-decisions-materiality` (partial)
- Known limitations: The materiality review is not final screenshot evidence and does not certify an uncommitted or later source revision.; Fresh-user timing and consented human usability trials remain open external proof gates.

### NodeKit had powerful engines but no coherent vehicle carrying a builder from an idea to a live, improving product, and its worst seam let the coding agent make product decisions while coding, so strong technical work still shipped the wrong interface.

- Event: `evt:builder-journey-j0`
- Source: `8325be69ee42c66ddc940f405e2bb0b3fe91e197`
- Resolution: Added the Builder Journey J0: nodekit.builder-case/v1 carries one venture through DECIDE to BUILD to EXPLAIN to LAUNCH to LEARN with one handoff artifact and receipt per stage, reusing Caseflow. nodekit.opportunity-contract/v1 is the Decide handoff that records the user, problem, wedge, primary job, inputs, primary artifact, rejected alternatives, open unknowns, success condition, and authority limits, so scope cannot be re-decided while coding. advanceStage is fail-closed: it blocks unless the stage's handoff artifact and a receipt exist and the receipt binds that artifact by content hash.
- Observed failure: There was no object sequencing the stages, and no approved boundary the coding agent had to build against; scope was re-decided during implementation.
- Invariants: `inv:builder-journey-stage-handoff` (partially-verified)
- Evidence: `evd:builder-journey-j0` (partial)
- Known limitations: Only the Decide to Build seam has a real handoff contract; the other four handoff artifacts are named and referenced but not yet given schemas or generators.; The builder journey is a contract and a fail-closed advance rule, not yet a running product surface, and no real builder has carried a case end to end.; The salon slice is a fixture, not a certified application; the EASE verdict remains EASE_NOT_CERTIFIED.

### J0 closed the Decide to Build seam with a fail-closed advance rule, but the approved OpportunityContract was still inert; nothing turned it into the inputs Build consumes, so the coding agent would re-decide the user, job, artifact, data authority, and permission boundaries while coding.

- Event: `evt:builder-journey-j1-decide-build`
- Source: `6a2716e3fcb3a344ca09e918cc7c57fc8ff9e237`
- Resolution: Added compileOpportunityToBuild in src/lib/opportunity-compiler.mjs. It maps a validated nodekit.opportunity-contract/v1 to a nodekit.product-design-contract/v1 and an Atlas reuse query. The contract's decided fields become the product contract's protected decisions (primaryUser, primaryJob, canonicalWorkflow, dataAuthority, permissionBoundaries pinned to nodekit; completionCriteria and finalVerdict pinned to nodeproof); every prohibited authority becomes a prohibited:<slug> anti-pattern in avoid; and a read-only wedge stays read-only in both the dominant action and the Atlas query. Zero new runtime dependencies.
- Observed failure: The boundary was recorded but not load-bearing: there was no compiler from OpportunityContract to a product-design contract, so the Build stage had no protected decisions to build against and scope could still drift during implementation.
- Invariants: `inv:opportunity-carries-to-build` (partially-verified)
- Evidence: `evd:builder-journey-j1-decide-build` (partial)
- Known limitations: The compiler produces Build inputs; it does not yet run the frontend tournament or generate the salon application, so no contract has been carried through to a rendered, certified surface.; The protected-decision pinning is verified by a unit test over the single salon slice; no real builder has carried an OpportunityContract through compile to build to certification.; This closes the Decide to Build hand-off mechanically; it certifies no application, and the EASE verdict remains EASE_NOT_CERTIFIED.

### J1 landed the Decide to Build compiler as a pure function, but it was still inert: nothing materialized its output into the files the Build stage consumes, and the base template a build agent specializes shipped a designed neo-brutalist stylesheet whose token surface was one line of eight color variables, so the design intent the compiler emits had nothing to map onto.

- Event: `evt:builder-journey-j1-finish`
- Source: `7bfc50e7373aa008200c8e199098200ca12691bf`
- Resolution: Added materializeBuildPacket, which compiles an approved OpportunityContract and writes the product-design-contract packet plus the Atlas reuse query into harness/frontend/product-packets, where compileFrontendPlan reads them; the packet name is validated so it cannot escape the directory. Refactored templates/base/apps/web/public/styles.css into a structured 30-token vocabulary (base palette, semantic status, feedback surfaces, accent surfaces, elevation, type scale, radius) with the dark block collapsed to token reassignments. A computed-style harness proved the refactor output-identical across 54 themed selectors in both themes.
- Observed failure: compileOpportunityToBuild returned a product contract in memory but never wrote the packet the frontend planner reads, and the template's design language (semantic status colors, feedback surfaces, the hard shadow, type weights, radii) was hardcoded and duplicated across the light and dark blocks, so scope could still drift at Build and the design could not be expressed or rethemed through tokens.
- Invariants: `inv:build-packet-carries-opportunity` (partially-verified)
- Evidence: `evd:builder-journey-j1-finish` (partial)
- Known limitations: The token-preservation check was a manual computed-style audit, not a committed automated test, so it proves this refactor but does not stand as a permanent regression guard.; materializeBuildPacket produces the Build stage inputs; it does not run the frontend tournament, render three directions, or generate the salon application.; No real builder has yet carried the salon case from Decide through a certified Build; the EASE verdict remains EASE_NOT_CERTIFIED.

## Architecture evolution

### Structural availability was mislabeled as browser certification.

- Event: `evt:rendered-browser-certification`
- Source: `e398398d7f1dd4ff0b65409d2c8da971e83bc488`
- Resolution: Structural checks and rendered Playwright evidence are separate, revision-bound proof classes.
- Observed failure: HTTP and DOM checks could pass without proving the rendered user journey.
- Invariants: `inv:rendered-browser-evidence` (verified)
- Evidence: `evd:rendered-browser-certification` (pass)
- Known limitations: External fresh-user timing evidence remains a separate submission gate.

### Historical receipts and internal deep imports could be mistaken for current package and submission guarantees.

- Event: `evt:exact-candidate-contract`
- Source: `1df155370258239ddd315c1f8842ecf0aa55b7e0`
- Resolution: NodeKit now exposes a supported Caseflow package entry point and requires eight distinct, contract-valid decisive verdicts bound to one clean candidate revision before submission.
- Observed failure: Existing proof aliases mixed source identities, omitted decisive revision fields, and exposed Caseflow through an unstable internal path.
- Invariants: `inv:exact-candidate-evidence` (verified), `inv:stable-caseflow-package-entrypoint` (verified)
- Evidence: `evd:exact-candidate-gate` (pass), `evd:caseflow-public-api` (pass)
- Known limitations: Current-revision timing, fresh-agent, human, consumer, preview, package, and independent ProofLoop evidence still must be collected.; The public Caseflow entry point is portable, but no authenticated Convex consumer has yet earned submission-grade adoption status.

### The portable Caseflow conformance suite named idempotency as a requirement without repeating decisions or completion calls.

- Event: `evt:caseflow-idempotent-retries`
- Source: `f3471c7fd31b4839ffeb9c9f43bd0d4ab7ef6bfc`
- Resolution: Caseflow now reuses an active run, returns the original approval for a repeated matching decision, returns the original completion receipt, and verifies all three behaviors in shared conformance.
- Observed failure: An adapter could pass conformance while duplicating artifact versions, approvals, or receipts during an ordinary retry.
- Invariants: `inv:caseflow-idempotent-retries` (verified)
- Evidence: `evd:caseflow-idempotent-retries` (pass)
- Known limitations: Each provider adapter must still demonstrate this contract against its real transactional backend.; Cross-tenant authorization remains an application-wrapper responsibility and is tested separately by each consumer.

### A checked-in SQL schema was being tracked as portability progress even though no executable NodeKit runtime implemented or proved the full Caseflow contract.

- Event: `evt:postgres-caseflow-adapter`
- Source: `5cc61578b3c1bd5b5c8195b83347b91f8b83242b`
- Resolution: NodeKit now ships a driver-neutral PostgreSQL Caseflow adapter, complete transactional schema, owner-scoped operations, stable public and typed exports, a disposable-provider conformance runner, and a complete Supabase RLS projection over the portable tables.
- Observed failure: The PostgreSQL layer lacked cases, runs, approvals, exceptions, receipts, owner-scoped runtime methods, public package exports, TypeScript declarations, and live provider conformance.
- Invariants: `inv:postgres-caseflow-conformance` (verified)
- Evidence: `evd:postgres-caseflow-conformance` (pass)
- Known limitations: The Supabase SQL projection has not yet passed authenticated live Auth, Storage, Realtime, Queue, and Cron conformance.; PostgreSQL subscriptions use polling and durable jobs remain an external runtime capability by design.

### Extracting Caseflow as an installable Convex Component could weaken receipt bindings, exception containment, retry idempotency, or host authorization boundaries.

- Event: `evt:convex-caseflow-receipt-retry-contract`
- Source: `4407b70c616c89b022e0d3d36ba02f00519b1688`
- Resolution: The human-reviewed contract requires one portable Caseflow lifecycle across memory, PostgreSQL, and Convex; host-owned authorization; receipt v2 content bindings; multi-exception containment; and fail-closed idempotency-key reuse.
- Observed failure: A reusable-looking component could reopen a still-blocked run, duplicate lifecycle objects during an ordinary retry, or emit a receipt that proves identifiers without proving content and actor bindings.
- Invariants: `inv:caseflow-receipt-retry-containment` (partially-verified)
- Evidence: `evd:convex-caseflow-receipt-retry-materiality` (partial)
- Known limitations: The materiality review is not an exact-revision live PostgreSQL or Convex provider result.; Authenticated consumer adoption and application-wrapper authorization remain separate proof gates.; The review grants no npm publication, production deployment, or Convex directory submission authority.

### Submission evidence could appear complete while describing another source revision, omitting decisive contract fields, duplicating evidence, or lacking scoped publication authority.

- Event: `evt:source-bound-submission-gates`
- Source: `4407b70c616c89b022e0d3d36ba02f00519b1688`
- Resolution: The human-reviewed release contract requires strict verdict schemas, exact candidate commit and distributable-source bindings, recomputed evidence hashes, distinct decisive evidence, a signed seven-gate candidate, and explicit scoped publication approval.
- Observed failure: Counts and familiar filenames were insufficient to prove that timing, agent, human, consumer, preview, package, independent-review, and approval verdicts described one immutable candidate.
- Invariants: `inv:source-bound-decisive-verdicts` (partially-verified)
- Evidence: `evd:source-bound-submission-gates-materiality` (partial)
- Known limitations: The external timing, fresh-agent, human, consumer, preview, and independent ProofLoop verdicts remain open until collected for the exact candidate.; This review grants no package publication, production deployment, or Convex Component submission permission.; Historical proof cannot certify the final candidate and final evaluation must be rerun after the immutable candidate exists.

### A proposal arrived to extract the user interface system as a standalone product named NodeKit Studio, listing five components it would contain.

- Event: `evt:studio-boundary`
- Source: `58dd5eeedb37e8af33f827ef24b5563d10249656`
- Resolution: Declared the boundary instead of building the product. A single module re-exports the existing implementations behind one package export subpath, following the pattern the Caseflow entrypoint already established. No file moved and nothing was forked; a test asserts the boundary owns exactly one function of its own so a future fork fails rather than silently becoming a second implementation. The loop is declared with an implemented flag per step, and the two steps that genuinely have no implementation, direct editing and reference ingestion, are declared false. Readiness is derived from those gaps rather than asserted. Extraction into a separate repository is deliberately deferred until the named consumers share this surface.
- Observed failure: All five components already shipped in this repository under other names. This was the fifth time a proposal turned out to be substantially pre-built, because nothing declared where the interface surface begins and ends. The real risk was rebuilding existing capability as a second platform, and the standalone claim could not be tested because there was no boundary to test.
- Invariants: `inv:studio-boundary-declares-gaps` (partially-verified)
- Evidence: `evd:studio-boundary` (partial)
- Known limitations: This adds no capability; it is a declaration, and a declaration cannot make an unrun benchmark run.; The comparison benchmark of raw prompt versus contract versus contract with Atlas versus full Studio has never been executed, so no advantage is demonstrated.; The frontend tournament has never run end to end against a real generated application.; Direct editing and reference ingestion have no implementation at all.; Nothing here certifies any application; EASE_NOT_CERTIFIED stands.

### Copying reviewed motion recipes between NodeSlide, NodeRoom, and parity-studio could preserve token names while changing timing behavior, and the existing drift script had no package API, schema-bound receipt, source-set identity, or fail-closed NOT_RUN state.

- Event: `evt:motion-portability-static-receipt`
- Source: `7a59bfb39d2d63f3330647a459e7cc029b9ed0c1`
- Resolution: Added one dependency-free motion portability comparator shared by the Studio API, nodekit motion compare CLI, and legacy wrapper. It normalizes spelling noise, binds exact CSS source sets, separates preserving aliases from review-only changes, emits a strict receipt, and keeps runtime, DOM/trace, video, and audience evidence explicitly NOT_RUN.
- Observed failure: The same --duration-fast name resolves to 180ms in NodeSlide and parity-studio but 120ms in NodeRoom; NodeRoom also carries internal 200/220ms and 380/400ms duration conflicts. A proposed one-value migration hid these additional owner decisions.
- Evidence: `evd:motion-portability-static-receipt` (partial)
- Known limitations: The supporting evidence proves the static comparison contract and its fail-closed behavior; it does not certify a runtime migration.; The comparator scans CSS custom-property declarations only; DTCG JSON, token consumption, runtime timing, DOM traces, video, and audience response remain outside this receipt.; The measured repositories fail with three conflicts; no migration is applied automatically.

### Consumer preparation could not verify the exact package on Windows because its supposed script-disabled pack still executed prepare.

- Event: `evt:consumer-package-verification-lifecycle-free`
- Source: `77069c870e6fb94475c6d9253ae9c6e1f85ec2bd`
- Resolution: Compare the supplied archive manifest directly with bounded clean tracked distribution bytes and never execute npm or lifecycle scripts during verification.
- Observed failure: npm pack ran prepare in the reduced distribution copy and failed with MODULE_NOT_FOUND before comparing a valid archive.
- Invariants: `inv:consumer-package-verification-lifecycle-free` (verified)
- Evidence: `evd:consumer-package-verification-lifecycle-free` (pass)
- Known limitations: This remains package preparation only; npm publication and deployment and authenticated Convex adoption are not claimed.

### Concurrent immutable artifact writers could observe a target path before the winning process had finished writing its bytes.

- Event: `evt:builder-gym-atomic-cas-publication`
- Source: `77069c870e6fb94475c6d9253ae9c6e1f85ec2bd`
- Resolution: Write and fsync a private same-directory temporary inode then atomically publish it with link and remove the private inode in a bounded finally path.
- Observed failure: A losing create-if-absent writer received EEXIST and compared against the winner's partially written destination; valid identical concurrent writes could be rejected as immutable conflicts.
- Invariants: `inv:builder-gym-cas-publishes-complete-bytes` (verified)
- Evidence: `evd:builder-gym-atomic-cas-publication` (pass)
- Known limitations: This guarantees complete local filesystem publication only; distributed object-store semantics and cross-host locking are not claimed.

## Harness evolution

### Visually polished frontend output could still miss the intended creator-workspace topology.

- Event: `evt:nodevideo-topology-contract`
- Source: `678f2e0b82c2c50c3741c8bbb2a80ed95ff5b159`
- Resolution: Added Frontend Specialist Routing with a protected product contract, three required rendered directions, independent criticism, explicit mobile topology, bounded repair, and a NodeProof-controlled canary.
- Observed failure: NodeVideo was organized as a proof dashboard instead of keeping the primary media artifact, agent context, and proposal review boundary legible across desktop and mobile.
- Invariants: `inv:major-frontend-direction-tournament` (partially-verified)
- Evidence: `evd:nodevideo-topology-failure` (partial)
- Known limitations: No real NodeVideo or NodeSlide consumer has yet completed the three-direction tournament and fresh-browser canary.; No exact resolved model identity was preserved for the historical failed attempt, so this event makes no model capability claim.

### The frontend tournament could print TOURNAMENT DECISIVE from booleans the candidate wrote into its own benchmark, so the NodeSlide pilot metric would have measured how cheaply an agent claimed to pass rather than whether a direction passed an independently observed gate.

- Event: `evt:frontend-decisive-evidence`
- Source: `f4bf70f5356c913aa3d7f28fab83ccba3f94877c`
- Resolution: The decisive verdict is computed from a Frontend Render Contract. A verifier-authored render receipt over the six required states, whose check statuses are derived from raw observations, plus an independent review receipt bound to the same state manifest, are graded DECISIVE / NOT_DECISIVE / FAIL / INCOMPLETE / UNVERIFIED; only DECISIVE authorizes. The benchmark schema dropped the three candidate booleans. A corruption corpus proves each self-attested shortcut lands on the correct graded verdict.
- Observed failure: decisive was browserChecksPassed && accessibilityPassed && overflowPassed && majorFindings.length === 0 over candidate-supplied fields; three true values and two empty arrays authorized the verdict with no evidence binding.
- Invariants: `inv:major-frontend-direction-tournament` (partially-verified)
- Evidence: `evd:frontend-decisive-evidence` (partial)
- Known limitations: The verifier command that drives a real browser over the six states and calls the assembler is not yet wired; receipts are assembled from observations, not from a live browser run.; Freezing a new tournament version so a benchmark cannot be replayed against a stale contract is a separate follow-on.; This makes the tournament's decisiveness honest; it does not by itself certify any real frontend, model, or consumer.

### NodeKit could prove what an application did but could not explain itself to the person who had to work on it. The proof machinery was far ahead of the explanations, so a senior engineer starting from an empty machine could not orient without private coaching.

- Event: `evt:journey-harness-and-tour`
- Source: `bfda0655c5593cdaa6dee0be0a34b21c4071f532`
- Resolution: The undeclared-lifecycle error now names what the repository declares and the next steps, and still exits 1. A derived repository map, an executable tour that verifies each step against disk and marks unobservable steps as explanations rather than passes, a glossary, a single orientation entry point, and a vocabulary-backed copy audit that blocks undefined jargon. A proposal to add a Human Journey Harness was checked against the repository first and found to be about eighty percent already built under other names, so nothing duplicating interaction-flow, human-study-event, builder-gym or fresh-user-study was added, and a guard test now fails if such a duplicate appears.
- Observed failure: A cold-start probe recorded seven friction findings, three of them P0: the README ran its first command before the install step; eleven NodeKit-specific terms appeared in the first five lines with no definition anywhere and no glossary existed; and nodekit demo from the platform repository dead-ended with a message that stated a fact and named no recovery.
- Invariants: `inv:tour-verifies-what-it-claims` (partially-verified)
- Evidence: `evd:journey-harness-and-tour` (partial)
- Known limitations: The cold-start baseline is an instrumented probe run by a coding agent, not a fresh-human study; five consented humans remain the real gate and nodekit.fresh-user-study/v1 is not satisfied by it.; The tour verifies four steps; two remain explanations and are labelled as such rather than made falsely checkable.; The copy audit covers three newcomer-facing surfaces; the 28 files under docs/ are not audited.; Recorded friction cannot yet become a candidate repair judged by the Builder Gym; the parts exist but are not wired into one path.; Nothing here certifies any application; EASE_NOT_CERTIFIED stands.

### NodeKit could prove that an artifact passed and record why the architecture changed, but it could not answer which code owns a behavior, which tests prove it, and which part has no proof. Separately, the recursive improvement loop was named in the roadmap but nothing connected a recorded friction observation to the Builder Gym that could judge a repair for it.

- Event: `evt:behavior-index-and-friction-loop`
- Source: `31fafad174431c28bb7dda7e1c37f6b1a2fa165d`
- Resolution: Added nodekit.behavior-index/v1, generated from behavior declarations in the existing repository manifest plus ownership and verification annotations in source and tests, with implementation and verification state derived rather than hand-maintained and drift surfaced in both directions. Added a friction loop that turns one recorded friction observation into one repair candidate the Builder Gym judges, with fail-closed adoption: a repair becomes adopted only by presenting an independent gym verdict that authorized promotion over an unchanged protected evaluator and held fixed inputs. No new schema family duplicates human-study-event, builder-gym, fresh-user-study or interaction-flow.
- Observed failure: Receipts, the Evolution Ledger, the repository map and interaction flows each answered a different question, and none answered behavior ownership. Recorded friction had no path to becoming a judged candidate repair, so improvement depended on someone remembering an observation rather than on a mechanism.
- Invariants: `inv:repair-cannot-self-approve` (partially-verified)
- Evidence: `evd:behavior-index-and-friction-loop` (partial)
- Known limitations: The behavior index reports the four declared behaviors only; it does not claim the repository has no other behavior, and an ownership annotation asserts ownership rather than proving it.; The friction loop produces and gates repair candidates but does not run the Builder Gym, and no repair has been carried through a real gym comparison end to end.; The cold-start baseline feeding the loop is an instrumented probe, not a fresh-human study.; Nothing here certifies any application; EASE_NOT_CERTIFIED stands.

### The friction loop gated repair adoption on the Builder Gym's promotionAuthorized flag, but the gym always seals that flag false by design because it measures whether a candidate is better and never decides that the better candidate should ship.

- Event: `evt:gym-proven-friction-loop`
- Source: `2a84faefeb0485df81cda36577e4857d271f5662`
- Resolution: Adoption now requires two independent things, following the shape the repository already uses for skill promotion: a gym verdict that passed with no regressed dimensions over an unchanged protected evaluator and held fixed inputs, and a separate promotion approval bound to that exact verdict by hash and naming a human approver. An approval bound to a different comparison is refused so one genuine success cannot be replayed onto later repairs. The loop is now driven against the real evaluateBuilderGym rather than against synthetic verdicts, and the gym laboratory was extracted to a shared test helper so two suites drive one setup.
- Observed failure: Adoption was unreachable, so the recursive improvement loop could never close. Had the flag ever been true, the gate would have treated a measurement as a permission. The unit tests did not catch this because they supplied hand-built verdict objects with promotionAuthorized true, a shape the real gym never produces, so the gate had been proven against a fiction.
- Invariants: `inv:measurement-is-not-permission` (partially-verified)
- Evidence: `evd:gym-proven-friction-loop` (partial)
- Known limitations: The comparison runs against a scaffolded laboratory application, not against this repository's own history; no production repair has been carried through the gym.; The promotion approval is validated for binding and authorship but is not cryptographically signed, unlike the skill promotion path.; Nothing here certifies any application; EASE_NOT_CERTIFIED stands.

### The friction loop refused to adopt a repair without both a passing Builder Gym comparison and a separate promotion approval, but the approval was checked for shape and binding only.

- Event: `evt:signed-repair-promotion`
- Source: `765c9ba3b126cab8ce616a809a40477fce709a7a`
- Resolution: Repair promotion approvals are Ed25519 detached attestations over a domain-separated statement with their own purpose, mirroring the skill promotion pattern but deliberately not sharing its domain or purpose, because a key trusted to promote a skill must not thereby be able to promote a repair. Adoption now requires a verified signature from a key trusted and authorized for the repair-promotion purpose, bound to both the comparison verdict hash and the repair identifier.
- Observed failure: Anything able to construct an object could grant the approval, including the agent proposing the repair. The separation of duties between proposing a change and permitting it to ship was structural but not enforceable.
- Invariants: `inv:repair-approval-is-signed` (partially-verified)
- Evidence: `evd:signed-repair-promotion` (partial)
- Known limitations: Trusted keys are supplied by the caller; there is no key registry, rotation policy or revocation path in this change.; The approval carries an issuedAt but no expiry, so an approval does not go stale on its own.; No repair has been carried through this path against this repository's own history; the comparison still runs against a scaffolded laboratory application.; Nothing here certifies any application; EASE_NOT_CERTIFIED stands.

### The behavior index answered which code owns a behavior for four hand-declared behaviors. For the rest of the repository the question it existed to answer was still unanswerable.

- Event: `evt:repository-wide-behavior-ownership`
- Source: `125c866913234da23c1d3778156c06ad5cab8660`
- Resolution: The index now covers the ledger's invariants as the repository's declared behavior, rather than asking anyone to re-declare the same statements in a second place. It distinguishes annotated-symbol, named-file-only and unowned, so a file-level pointer is not counted as coverage, and it reports invariants whose verifier paths no longer exist. Owners were annotated across caseflow conformance, the package entrypoint, submission gating and preparation, the factory, the frontend tournament, the builder journey, the decide-to-build compiler, the friction loop, repair approval, and the generated application's browser certification. All eighteen now resolve to a definition.
- Observed failure: Measured with ledger coverage in place and before any annotation: of the eighteen human-reviewed invariants the Evolution Ledger already declares, zero were owned by a named symbol, thirteen named a source file only, and five were claimed by nothing at all. Naming a file sends a reader hunting through thousands of lines rather than landing on the definition that enforces the guarantee.
- Invariants: `inv:ownership-resolves-to-symbol` (partially-verified)
- Evidence: `evd:repository-wide-behavior-ownership` (partial)
- Known limitations: An ownership annotation asserts that a symbol enforces an invariant; it does not prove it, and the index cannot detect a claim that is simply wrong.; The eighteen invariants are the ledger's population, not every behavior in the repository; behavior that never earned an invariant remains uncovered.; Nothing here certifies any application; EASE_NOT_CERTIFIED stands.

### The behavior index made ownership answerable, but an annotation only asserts that a symbol enforces an invariant. Nothing bound the guarantee to the assertion that checks it.

- Event: `evt:invariant-proof-binding`
- Source: `dcf7546bc63b4dc05f4fc52828c763d074d35d19`
- Resolution: Verification is reported with the same strictness as ownership. A test that names the invariant and its scenario is annotated-test; a verifierRef naming a test file that claims nothing is named-test-file-only and is not counted as verified; neither is unverified. An invariant is fully bound only when a symbol owns it and a named assertion proves it. All twenty are now fully bound.
- Observed failure: With verification coverage in place and before any binding, all nineteen ledger invariants were owned by a definition but none was proven by a named assertion: every proof was a test filename. A filename says proof lives somewhere in the file, and the file keeps passing long after the assertion that mattered was deleted or rewritten.
- Invariants: `inv:invariant-proof-is-bound` (partially-verified)
- Evidence: `evd:invariant-proof-binding` (partial)
- Known limitations: A binding asserts that a test exercises an invariant; the index checks the claim exists and is well-formed, not that the assertion actually covers the guarantee. One wrong binding was caught only by reading the test.; Coverage is per invariant, not per clause: an invariant naming several properties reports bound when one assertion claims it.; Nothing here certifies any application; EASE_NOT_CERTIFIED stands.

### A generated interface could pass every visual check while the text on the screen was false. The render contract proved that states rendered; nothing checked whether the sentences claimed a completion that never happened or an authority the agent did not hold.

- Event: `evt:copy-as-proof-surface`
- Source: `1302f5bf3d1ffe3848d7a43da1e789e5b49e3d79`
- Resolution: Added a claims audit that fails only objectively wrong statements and treats style as advisory that can never change the verdict, because a supplied voice sample may legitimately require the patterns a linter would flag. Fabrication is a deterministic entity diff against approved source material, and when no source is supplied it reports unchecked rather than passing. The audit extends the existing frontend review evidence path and the Studio surface rather than opening a new receipt family.
- Observed failure: The existing copy audit covered undefined jargon and authority terms only. Four ways for generated copy to be objectively wrong had no check at all: fabricated entities, unsupported capability claims, a finished status with no receipt behind it, and a failure message naming no next action.
- Invariants: `inv:copy-claims-gate-lies-not-taste` (partially-verified)
- Evidence: `evd:copy-as-proof-surface` (partial)
- Known limitations: The audit checks whether claims are wrong; it cannot judge whether copy is good.; Fabrication detection covers URLs, dates, money and percentages, so an invented prose claim containing none of those is not caught.; Unsupported-claim detection is a pattern list and catches common forms rather than novel ones.; Detecting a missing recovery action required three attempts, each correct about the previous failure and wrong about the next; the class of error is a word's presence being read as its role.; Nothing here certifies any application; EASE_NOT_CERTIFIED stands.

