// The gate the docs cite five times and the code never had. The load-bearing test is the GAMED one:
// a two-variant diff that only checks "did anything change" certifies a decorative mechanism,
// because a fast-forward changes the during-run observation and lands on the same end state.

import assert from "node:assert/strict";
import test from "node:test";
import { formatNecessity, KNOCKOUT_METHODS, verifyCausalNecessity } from "../src/lib/knockout.mjs";

const claim = (over = {}) => ({
  claim: "the stagger makes the queue readable",
  mechanism: "row entrance stagger",
  method: "mechanism-removed",
  baseline: { observed: "rows appear one by one over 232ms", terminalState: "all six rows visible" },
  knockout: { observed: "all six rows visible immediately at frame 0" },
  ...over,
});

test("a mechanism whose removal changes nothing is present, not responsible", () => {
  const verdict = verifyCausalNecessity(claim({
    knockout: { observed: "rows appear one by one over 232ms" },
  }));
  assert.equal(verdict.necessary, false);
  assert.match(verdict.reason, /present, not responsible/);
});

test("a knockout landing on the baseline's terminal state proves nothing", () => {
  // The exact route the design council recorded: the run reached the end it was always heading for.
  const verdict = verifyCausalNecessity(claim({
    knockout: { observed: "all six rows visible" },
  }));
  assert.equal(verdict.necessary, false, "differing from the baseline is not enough");
  assert.equal(verdict.gamed, true);
  assert.match(verdict.reason, /terminal state/);
  assert.match(formatNecessity(verdict), /gamed knockout/);
});

test("a real removal that lands somewhere else establishes necessity", () => {
  const verdict = verifyCausalNecessity(claim());
  assert.equal(verdict.necessary, true);
  assert.match(formatNecessity(verdict), /load-bearing/);
});

test("methods that cannot establish necessity are refused by name, with the reason", () => {
  for (const method of ["fast-forward", "duration-zeroed", "disabled-flag"]) {
    assert.throws(
      () => verifyCausalNecessity(claim({ method })),
      (e) => e.code === "KNOCKOUT_METHOD_UNSOUND" && /cannot establish necessity/.test(e.message),
      method,
    );
  }
  // And the two sound ones are accepted.
  for (const method of ["mechanism-removed", "input-withheld"]) {
    assert.equal(verifyCausalNecessity(claim({ method })).necessary, true, method);
  }
  assert.equal(KNOCKOUT_METHODS.length, 5);
});

test("without a declared terminal state the gaming route is undetectable, so it is required", () => {
  assert.throws(
    () => verifyCausalNecessity(claim({ baseline: { observed: "rows stagger" } })),
    (e) => e.code === "KNOCKOUT_TERMINAL_UNKNOWN",
  );
});

test("an observation is required on both sides; a verdict is not an observation", () => {
  assert.throws(() => verifyCausalNecessity(claim({ knockout: { observed: "" } })), /needs an .observed. field/);
  assert.throws(() => verifyCausalNecessity(claim({ mechanism: "" })), /needs mechanism/);
});
