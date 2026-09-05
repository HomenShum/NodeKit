# Generated consumer handoff: exact outcome and portable proof

A developer needs the result they approved to remain the result another person downloads and verifies. This patch preserves the exact submitted text in canonical content, exposes its artifact identity/version/hash, and reveals the existing download controls on actual completion. Failed or rejected work preserves the prior result. The error strip occupies no pixels when hidden.

Status: implemented and behavior verified; awaiting independent judge and committed-source factory replay. Browser certification is **false**: its unchanged identity gate correctly reports `BROWSER_JOURNEY_PASS_IDENTITY_UNBOUND` and exits 1. This evidence does not certify release, full UI quality, host activation or production readiness.

Read [the generated consumer quickstart](../../templates/base/README.md) and its [AGENTS contract](../../templates/base/AGENTS.md) first. The actual replay used a retained local NodeKit package, installed launcher and fresh generated consumer under Node 22.22.2. [package/nodekit.tgz](package/nodekit.tgz) contains the exact 421-file candidate package; its SHA-256 and source bindings are in [receipt.json](receipt.json). No model or provider call was made.

## Evidence to inspect

- [Before 390](before/390/change-boundary.png) and [after 390](after/390/after.png) use the same neutral outcome and 390x960 viewport. The 1440 folders use 1440x960. Before boxes are genuine 3px DOM overlays; after images are rendered pixels.
- [Real-input failure](before-real-input/observed-failures.json) records lost Unicode/whitespace input, hidden download and an empty visible error strip on the unchanged base.
- [Actual transport failure](journey/390/transport-error.png), [recovered pending proposal](journey/390/retry-pending.png), [approved result](journey/390/approved-no-error.png), [fresh context](journey/390/fresh-context-identical.png) and [journey report](journey/report.json) cover the real input at 390 and 1440.
- [Browser report](browser-certification.json) records 180 captures across six widths, two themes and fifteen states; all 18 journey assertions pass. The original certificate remains unbound. Files named `nodekit-altered-*` are deliberately invalid knockout inputs, never valid approval evidence.
- [Local release proof](release-proof.json) passes its local checks and keeps releaseReady:false.

## Replay and remaining gates

From a newly generated consumer, run `npm ci`, `npm run compile`, `npm run check`, `npm run demo`, `npm run eval`, `npm run proof:browser-contract`, `npm run proof:browser`, then `npm run proof`. Chromium must already be installed or installed with the documented Playwright command. The full browser command deliberately fails certification without exact committed NodeKit source and tarball bindings; inspect passed versus certified separately. After judge approval and a clean reviewed commit, run the unchanged NodeKit factory with `NODEKIT_KEEP_ACCEPTANCE=1` and retain its original launcher, consumer and release proof.

Reload and a fresh browser context reconnect to the same in-memory server. They do not establish persistence across server restart; download before reset/restart. The conflict route is the existing deterministic competing-proposal fixture; the exact-input workflow test separately proves a winning user outcome survives a stale competing proposal. Duplicate approval produced one request. A 31-second, 20-reload replay preserved identity and event count; this is bounded state-stability evidence, not a production load benchmark.

Protected neighbors were header/type system, stage and case navigation, state banner, review/activity controls and runtime approval policy. The only added review-pane behavior exposes its existing receipt actions on actual completion. The derived behavior index and two source anchors were corrected without changing any invariant or gate. Existing ledger/authority holds and full responsive/visual/interaction grades remain open. No deployment, remote CI, host hooks, paid-provider evaluation or fresh-human study is claimed.

Raw command logs and private source/consumer custody stay in the protected operator packet. Their hashes are listed in the receipt; they are not linked as portable files. Both earlier consumers remain unchanged.
