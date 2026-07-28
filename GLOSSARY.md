# Glossary

Every term here appeared in NodeKit documentation before it was defined anywhere. The cold-start
baseline found 11 such terms in the first five lines of `README.md` alone
(`harness/journey/baseline-2026-07-24.json`, finding F2). Plain definition first, then why the term
exists.

If you add a NodeKit-specific term to user-facing copy, define it here. `npm run copy:audit` fails
when it finds an undefined one.

## The words in the first paragraph

**figured-out**
The product decisions are already made and encoded, so you do not re-decide them per project. A new
application starts with a working lifecycle, not a blank page. It does NOT mean finished or
certified.

**domain-blank**
The generated application knows *how* to run a workflow but nothing about your industry. It has no
salon logic, no invoice logic, no medical logic. You specialize it against a real user's job. This
is deliberate: a preset guessed wrong more often than it helped.

**conformance layer**
A set of checks a generated application must keep passing to still count as a NodeKit application.
"Conformance" is about obeying the contract, not about quality.

**proof-carrying**
The application ships the evidence for its own claims. A result arrives with a receipt binding it to
the exact inputs and code that produced it, so you can re-check it instead of trusting it.

**guided lifecycle**
The fixed path every generated application runs: Case → Run → Stage → Artifact → Proposal → Approval
→ Receipt. "Guided" means the path is supplied; you do not design it per app.

**compiled definition**
Your application's YAML configuration turned into a validated, frozen object. Compiling fails loudly
on a bad definition instead of failing mysteriously at runtime.

**deterministic fixtures**
Fixed sample inputs that produce byte-identical outputs every run. They make a demo repeatable and a
test trustworthy — no network, no clock, no randomness.

**browser proof**
Evidence produced by actually driving a real browser (screenshots, console logs, checks) rather than
by asserting a page "looks right". Introduced because a component can pass unit tests and still
render a broken screen.

**receipt**
A signed-ish record binding a result to its inputs: which artifact, which version, which content
hash. If the content changes, the receipt no longer matches. This is what makes a claim checkable
by someone who does not trust you.

**Convex-first, not Convex-locked**
Convex is the default backend and the one exercised most, but the behavior is defined so PostgreSQL
or Supabase can back it too. "Not locked" is a portability claim, not a promise that every backend
is equally tested.

## The words you meet next

**Caseflow**
The runtime implementing the guided lifecycle. One case moves through stages, produces artifacts,
and collects receipts. Backend-neutral by design.

**Evolution Ledger**
The record of *why* the system changed: the observed failure, the resolution, the invariant it
protects, the evidence, and a human review. A change to `src/`, `schemas/`, `templates/base/`,
`harness/`, `nodekit.yaml`, `ownership.yaml`, or `.github/workflows/` is **material** and cannot
land without an entry.

**material change**
A change to one of the paths above. Material changes need a reviewed Evolution Ledger entry. Other
changes do not.

**invariant**
A property that must hold no matter what, with a named verifier that enforces it. Example: a builder
case cannot advance a stage unless that stage's artifact exists AND a receipt binds it by content
hash.

**NodeProof**
The authority that decides whether a result passed. Deliberately separate from whatever produced the
result — a generating model never grades its own output.

**EASE / EASE_NOT_CERTIFIED**
An external certification standard NodeKit targets. `EASE_NOT_CERTIFIED` is the honest current
verdict and appears throughout on purpose: nothing here claims certification it has not earned.

**OpportunityContract**
The approved boundary a coding agent builds against: the user, the problem, the wedge, the primary
job, the artifact, what was rejected, what is still unknown, and what the agent may and may not do.
It exists so scope is decided *before* implementation instead of drifting during it.

**fail-closed**
When evidence is missing or does not match, the answer is "blocked", never "probably fine". Most
NodeKit gates are built this way.

**behavior portability**
A copied interaction keeps the behavior it was authored to have, even when the destination
repository uses different libraries or legacy token names. NodeKit compares resolved semantics,
not just whether a familiar name exists.
