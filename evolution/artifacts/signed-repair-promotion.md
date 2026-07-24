# An unsigned approval is not an approval

The friction loop already refused to adopt a repair without a passing Builder Gym comparison AND a
separate promotion approval. The approval was checked for shape and binding only, so anything able
to construct an object could grant it — including the agent proposing the repair. The separation of
duties was structural but not enforceable.

## What changed

Repair promotion approvals are now Ed25519 detached attestations, mirroring the pattern the skill
promotion path already uses, with one deliberate difference: a distinct domain string and a distinct
purpose (`repair-promotion-approval`).

That difference is the point. Reusing the skill purpose would let a key trusted to promote a SKILL
also promote a REPAIR — privilege escalation by accident rather than by attack. Domain separation
means the signed bytes are not merely a payload hash: a signature produced under any other domain
does not verify here.

`adoptRepair` now requires a verified approval: a correct signature, from a key trusted for the
repair-promotion purpose specifically, bound to both this comparison's verdict hash and this
repair's identifier.

## Evidence

`test/repair-approval.test.mjs`, 7 of 7. The adversarial cases carry the weight:

- A signature made with the SAME key over the SAME payload under a foreign domain does not verify.
  Without the domain prefix the signed bytes are just a hash, and a hash signed for one purpose
  verifies for any other.
- Editing any approved field — the approver, the repair, the verdict hash — breaks the binding.
- An approval bound to a different comparison, or to a different repair, is refused.
- An untrusted key is refused, and a trusted key that is not authorized for this purpose is refused.
- The approval hash is the SHA-256 of its canonical body, so a third party can recompute it without
  trusting this code.

`test/friction-loop.test.mjs` (4/4) and `test/friction-loop-end-to-end.test.mjs` (4/4) were re-run
against real signatures rather than plain objects, so the loop's separation of duties is now
enforced rather than merely described.

## Known limitations

- Trusted keys are supplied by the caller. There is no key registry, rotation policy, or revocation
  path in this change.
- The approval carries an `issuedAt` but no expiry, so an approval does not go stale on its own.
- No repair has been carried through this path against this repository's own history; the
  comparison still runs against a scaffolded laboratory application.
- Nothing here certifies any application. `EASE_NOT_CERTIFIED` stands.
