# Current governance package and generated consumer proof

A developer can install the reviewed current package and use the generated application to review, accept and download an artifact with its matching receipt. This packet verifies that the governance repair did not leave the working factory tied to an older package identity.

The actual ordinary factory ran at source commit `0d2223815ef73b80eeed8ce3dc6b96d16b3a2825`, source hash `cbd062964a7ada1774848f31408f2ffa3fc2953cfa28a096d398cb116810bf64`. All 13 base checks pass in one 178511ms Windows/npm run with warm-or-unknown cache. The exact package tarball SHA256 is `efdf7edd77ec47a5e4fff5514950e4eaa76068e93c52a442371163363170bdeb`.

The [independent judgment](E3e_NODEKIT_CURRENT_FACTORY_JUDGE.md.txt) and [machine receipt](E3e_NODEKIT_CURRENT_FACTORY_JUDGE.json) verify all 421 package files against source and both actual installations, 1675 retained artifacts, and all 180 screenshot/sidecar bindings. Its additional mobile accept/download/reopen journey passes 36 checks with four captures and no runtime errors. The screenshot grid includes presentation scenarios; it is not 180 independent end-to-end journeys. The reviewer visually inspected three factory images and the four independent captures.

The new package is browser-certified for its recorded source-bound lane. Overall factory status remains **EASE_NOT_CERTIFIED**, with `submissionReady=false` and `releaseReady=false`. Whole-PR authority, heldout/human/device/platform, deployment and aggregate timing gates are not inferred from this run. The source changes also pass the separately retained 857-test governance suite; this packet does not relabel the older 855-test consumer run.

The generated 77-file archive exactly matches its real Git commit. Of those files, 76 also match the retained working directory; the existing friction recorder subsequently appended measured completion events to `proof/build-friction.json`. Both byte identities are disclosed by the judgment. No claim that the whole generated consumer stayed clean is made.

The earlier 372 factory files remain preserved under the custody manifest. The e7e4b10 factory certificates stay historical. The current generated archive and full browser grid remain in `proof/ease/latest`, with `proof/factory-acceptance.json` as the actual source factory receipt. This packet adds original consumer JSON receipts, the current NodeKit tarball, exact independent reviews and a mapping of historical source paths. See [manifest](manifest.json).

Governance finalization is independently checked at actual metadata commit 0d222381. It preserves raw mutation count 1, acknowledged 1 and unresolved 0, with no new canonical event or signature. Its deferred receipt covers only bf6ff6c through 0c33b8a. The whole-PR materiality command remains blocked across its 21 material files; the existing workflow authority and H1 credential gate remain separate. A successful factory cannot manufacture that approval.

Reproduce with `npm ci`, `npm test` and `NODEKIT_KEEP_ACCEPTANCE=1 npm run acceptance:factory` using the environment syntax of your shell. Preserve `proof/ease/latest` before another normal factory run because that command replaces the directory. Shared integration follows normal draft PR39 review and CI; this packet alone does not certify a release.
