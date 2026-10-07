# Governance: how NodeKit proves itself

This is the maintainer-facing status of the platform's own gates —
certification, attestation, and what remains open. A consumer building an
app does not need anything on this page; the receipts your generated app
produces are documented in the app itself.

## Current status

- **Closed locally:** domain-blank factory; portable Caseflow; PostgreSQL adapter; Convex component
  and installed-package runtime; Supabase local managed profile; browser proof-bundle
  download/reopen verification; recursive evidence verification; and the EvoGraph-R1-inspired
  Knowledge Evolution and Evolution Ledger mechanics.
- **Open locally:** complete integration review, run the full repository suite, freeze one immutable
  candidate, and regenerate its package/browser receipts. This README does not claim the current
  mutable working tree is fully green.
- **Open externally:** exactly 60 candidate-bound timing runs, 15 real fresh-agent v2 runs, five
  consented humans, three authenticated Convex consumers, an isolated preview, live Supabase proof,
  real Knowledge Evolution adoption, final independent ProofLoop, and publication approval.

Current certification verdict: **`EASE_NOT_CERTIFIED` - DO NOT SUBMIT**.

The detached-signature trust model, verifier ownership rules, and signing handoff are documented in
[`docs/ATTESTATIONS.md`](https://github.com/HomenShum/NodeKit/blob/main/docs/ATTESTATIONS.md). A local maintainer-generated signature is not an
independent external gate attestation.

