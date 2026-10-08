# Changelog - required Quality gates

> **Surface**: Required Quality gates and the repository dependency lock.
>
> **Append rule**: New entries go at the top and released entries are never rewritten.

## 2026-10-08 - Read original authorship without claiming current measurements

A maintainer reviewing an old supported assumption must be able to read its
original meaning without treating missing measurements as evidence. Restore the
original immutable record and qualify historical authorship only from continuous,
full native Git history, the pinned schema epoch and the original schema hash.
The current measured dimensions remain explicitly unknown. Current admission,
evidence, authority, schema and materiality requirements are unchanged. Raw
queries say verification was not run and never certify current measurements.
Native origin reads have record, byte and time bounds; replacement objects and
graft files cannot manufacture the inspected history view.

**Before / after**: `NODEKIT-AUTHORED-HISTORY-CURRENT-MEASUREMENT-SEPARATION-01`,
local Windows capture on 2026-10-08 against PR40 head `6d50b204`. The original
verifier returned exit 1 with one claim-mutation issue; restoring only the
original record returned exit 1 with three current-schema/measurement issues.
The repaired source returned a durably captured exit 0: zero issues and claim
mutations, all 92 records checked using full Git history, three reported binding
repairs, and unchanged counts of 25 events, six assumptions, 24 invariants,
34 evidence records and three adoptions. One historical qualification explicitly
sets current measurement certification false. Ten warnings remain, including the
unknown dimensions and the existing 22 unattested events; no approvals were
invented or signed. Three existing attestations remain credential-control
assurance, not proof of human presence.

**Scenario proof**: the final two-file run returned a durably captured exit 0,
27 passes, zero failures and zero skips. It retains mutation, new/moved/readded
path, shallow/outside-epoch, broken-history, replacement/graft, current
admission/evidence, raw-query, four disjoint concurrent-read and eight sustained
read boundaries. Prior long-temp setup failures and the later fixture checkout
failure remain in the external proof. The latter exposed an incorrectly ordered
fixture prerequisite; one ordinary restore inside that owned clone fixed setup
without weakening an assertion. The external receipt writer was also corrected
to persist the native exit immediately; its earlier lost exit remains unknown.
The pinned authored-schema digest/missing-schema fail-closed branches were
source-reviewed, not separately manufactured as synthetic history proof.

The existing behavior-index generator returned exit 0 and updated only source
line bindings; its 31 undeclared annotations remain reported. The existing docs
generator and projection-drift check both returned exit 0, with both tracked
projection files byte-identical. No source-independent product, rendered-pixel,
performance, deployed-content or current-measurement certificate follows.
At this local capture, new exact-head hosted CI is pending and whole-PR
materiality/authority coverage remains unresolved. No canonical event, signature,
clock change, policy waiver or merge is included. Historical entries below are
preserved byte for byte.

**Commit**: `this commit`. **Author**: Codex.
**Touches**: `evolution/assumptions/asm-strong-model-infers-topology.json`,
`src/lib/evolution-immutability.mjs`, `src/lib/evolution-ledger.mjs`,
`src/cli-main.mjs`, both evolution test files, `docs/EVOLUTION_LEDGER.md`,
`behavior-index.json`.

## 2026-10-08 - Patch the compatible repository test toolchain

The repository now declares Vitest 4.1.11 instead of 4.1.10 and retains the
published matching Vitest-family lock records. The same lock resolves NanoID
3.3.19, PostCSS 8.5.28 and source-map-js 1.2.2. These records address the
[Vitest](https://github.com/advisories/GHSA-82fw-gwwq-j7x9),
[NanoID](https://github.com/advisories/GHSA-2v37-7h3g-55p8),
[PostCSS](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) and
[source-map-js](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) findings
reported by the actual PR40 baseline lock audit.

**Scope**: exactly 12 existing lock records change: one root declaration, eight
Vitest-family records and three development leaves. All 159 entry paths remain;
the other 147 records and unrelated parent ranges are unchanged. The published
changed records update matching Vitest dependency/peer pins and PostCSS's NanoID
range from `^3.3.16` to `^3.3.18`. Preserve the existing fast-uri 3.1.8 fix,
application dependencies, scripts, workflows and separate consumer locks.

**Before / after**: `NODEKIT-PR40-MATCHED-LOCK-AUDIT-REPAIR-01`, captured locally on
Windows on 2026-10-08 using Node 22.22.2/npm 10.9.7. Exactly one normal
`npm audit --package-lock-only --json` per role: unchanged PR40 head `d1f42b57`
returned exit 1 with five package findings (three moderate, two high); the new
lock returned exit 0 with zero findings. Both stderr streams were empty and both
commands retained their package/lock bytes. No install, application import or
test ran locally; this audit result is not a comprehensive security certificate.

At this capture, new exact-head hosted CI and toolchain execution are NOT_RUN
and remain required before merge. Existing PR40 Quality is successful, but its
Evolution verification failure and neutral, timed-out secret scan remain
separate merge holds. No workflow, attestation, rendered-pixel or deployed-product
claim follows from this lock-only proof. Historical entries below remain intact.

**Commit**: `this commit`. **Author**: Codex.
**Touches**: `package.json`, `package-lock.json`.

## 2026-10-07 - Retain the production audit and patch the repository URI dependency

The repository lock now resolves AJV's existing `fast-uri ^3.0.1` dependency
from 3.1.5 to 3.1.8. Change only the version, registry tarball URL and published
integrity in that one lock entry. Package declarations, all other locked packages,
the npm ci install and the required production audit are unchanged.

**Why**: the required audit was reached after all 898 Node tests and eight component
tests passed at head `86b0e967`, then failed on one high-severity package finding
with six advisory URLs. The upstream v3 fixes are 3.1.6, 3.1.7 and 3.1.8;
[3.1.8 is the common minimum](https://github.com/advisories/GHSA-hrr3-gc8f-f4qj).
Use the exact URL and integrity from the primary npm registry metadata.

**Before**: automatic Quality run 37628784796/job 112817332066; registry and pack
were skipped after the audit failed. **After**: next exact-head automatic CI pending.
No local resolver, generator, install or held verification was executed. This
updates this repository's install, not every published-library consumer's lock.
No concrete outbound SSRF path, pipeline gain, deployment or visual grade is implied.

**Commit**: `this commit`. **Author**: Codex.
**Touches**: `CHANGELOG/cli/dashboard.md`

## 2026-10-07 - Install Chromium before the required browser check

The Quality runner now installs the already-declared Playwright Chromium browser
and its operating-system dependencies before tests. The browser check remains
decisive; it is not skipped when its executable is missing. Retain current
typecheck, component, full-test, audit, registry and package stages, including
existing citation coverage within tests.

**Before**: head `89303076`, Quality job112774957236 failed the browser self-test
because Chromium was absent. **After**: combined exact-head automatic CI pending
at publication. Source retained from PR #40; no manual dispatch or local install,
deployment, rendered UI grade or production verification is implied.

**Commit**: `this commit`. **Author**: Codex.
**Touches**: `.github/workflows/quality.yml`
