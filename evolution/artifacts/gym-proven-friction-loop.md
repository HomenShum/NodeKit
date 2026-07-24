# A passing comparison is not permission to ship

The friction loop gated adoption on the Builder Gym's `promotionAuthorized` flag. Driving the real
gym end to end proved that gate wrong.

## The defect

`evaluateBuilderGym` always seals `promotionAuthorized: false` and `realWorldClaimAuthorized: false`.
This is deliberate. The gym measures whether a candidate is better than a baseline over a protected
evaluator and fixed inputs. It does not decide that the better candidate should ship.

Gating adoption on that flag therefore made adoption unreachable: the loop could never close. Worse,
had the flag ever been true, the gate would have treated "measured as better" as "approved to ship",
collapsing a measurement into a permission.

Unit tests did not catch this because they supplied hand-built verdict objects with
`promotionAuthorized: true` — a shape the real gym never produces. The gate was proven against a
fiction.

## The correction

Adoption now requires two independent things, following the shape the repository already uses for
skill promotion (`nodekit.skill-promotion-approval/v1`):

1. A gym verdict that passed, with no regressed dimensions, over an unchanged protected evaluator
   and fixed inputs that held.
2. A separate promotion approval bound to that exact verdict by hash and naming a human approver.

## Evidence

`test/friction-loop-end-to-end.test.mjs` drives the real gym, 4 of 4:

- A real passing verdict alone is refused. It adopts only when a bound approval accompanies it.
- A materially worse candidate is judged `regressed` by the real gym and refused, with the outcome
  named in the refusal.
- An approval bound to a different comparison cannot be replayed onto this repair, so one genuine
  success is not a skeleton key for later repairs. An approval nobody signed is also refused.
- The gym refuses to evaluate against a lock identity that was not externally pinned.

`test/friction-loop.test.mjs` still holds the unit gate at 4 of 4, with six routes to self-approval
blocked. `test/builder-gym.test.mjs` is unaffected at 13 of 13. The gym laboratory was extracted to
`test/helpers/builder-gym-lab.mjs` so two suites drive one setup rather than a second copy drifting
from the first.

## Known limitations

- The comparison runs against a scaffolded laboratory application, not against this repository's own
  history. No production repair has been carried through the gym.
- The promotion approval is validated for binding and authorship. It is not cryptographically
  signed, unlike the skill promotion path.
- Nothing here certifies any application. `EASE_NOT_CERTIFIED` stands.
