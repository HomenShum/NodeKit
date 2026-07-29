# Mew migration — run report, 2026-07-29

Three runs, one honest arc. **Overnight:** both wave-0 halves stopped on their kill conditions,
with receipts. **Daytime:** waves 1–4 were traversed on structure — real code, real gates, every
data-dependent field defaulted-with-disclosure or NOT_RUN. **Mid-traversal correction:** the owner
corrected the ground truth — **Mew IS the Ideaflow application, and full checkouts live locally**
(`D:/VSCode Projects/Ideaflow/`). Everything was rebound to the real graph model read from that
code, and the chain closed: **PASS, 5/5 stages, 6/6 digests.** Zero database records and zero
evaluated cases were fabricated at any point.

## Wave 0 (overnight) — receipts, and what the correction did to them

| half | outcome then | status now |
|---|---|---|
| Notion test cases (0A) | NOT_RUN — ruled the "Notepad CRUD Agent Key Takes" doc out as case-invention for "the old MewAgent codebase" ([PR #26](https://github.com/HomenShum/node-platform/pull/26)) | **Judgment inverted by ground truth**: the MewAgent codebase is the local Mew codebase. The doc's expected-output trees are owner-authored acceptance cases — **3 harvested verbatim** with falsifiable assertions and sourcePageId anchors into `harness/mew-migration/notion-cases.json`. All 3 NOT_RUN (they exercise CRUD orchestration this retrieval-only slice does not implement, and need a populated graph). |
| Ideaflow export (0B) | KILL — no signed-in ideaflow.app session ([PR #27](https://github.com/HomenShum/node-platform/pull/27)) | **Superseded, not deleted**: the probe was honest, its premise was wrong — no web sign-in was ever needed. The source is local code plus a remote Postgres whose credentials this run deliberately did not use. See `proof/mew-migration/local-recon.json`. |

## Local recon (read-only, receipted)

- The real Mew data model is a **typed property graph** in Postgres via drizzle:
  `graph_node` / `graph_relation` / `relation_type` / `relation_lists`. **No tag table** —
  hashtags are content tokens and relations. The earlier notes/links/tags schema (guessed from
  public docs) was wrong and was replaced.
- Bound schema: `personal-dev-mew/mew/src/db/schema.ts`, sha256 `d79b2bd0…`, commit `3013c596`.
  Schema drift is real across the owner's branches (latest-main adds `contentText`/`relationCount`/
  `attributes`/`canonical_path_cache`; prod-push adds `attributes` + MCP settings) — drifted
  records **refuse loudly** until the owner picks the branch.
- **No local data store exists.** Inventory (N nodes, M relations) is unmeasured: measuring needs
  the credentials in `.env.local`, and this run read environment variable **names only**, opened
  no connection, wrote nothing into any Ideaflow directory.
- **Owner input #1 is now one command**: `yarn tsx scripts/export-database.ts <dir>` in
  `personal-dev-mew/mew` — the app's own exporter (sha256 `ebdceb96…`). Its exact output shape
  (`{data, users, graphNodes, graphRelations, relationTypes, relationLists}`) is what the importer
  now targets.

## Waves 1–4 — the traversal

| wave | what exists now | receipt |
|---|---|---|
| 1 DECIDE | OpportunityContract rebound to the real schema: drift policy, dedup by (id, authorId) semantics, counted whole-table drops (`users`, `data`) and field drops (`pk`, `content_tsvector`) — every decision **defaulted-with-disclosure**, countersigned by no one; inventory unknown, never estimated | `proof/mew-migration/chain/opportunity-contract.json` |
| 2 BUILD | `nodekit create` scaffold (`--backend filesystem`; create has no convex adapter) + **hand-written `convex/schema.ts`** for the four graph tables — accepted by a real Convex backend, ten indexes; importer whose manifest **closes per table**; **BuildEvidencePack via `nodekit journey build-evidence`** (PR #24's producer cherry-picked from `origin/feat/journey-producers`; new `--honoured` CLI flag): 5 honoured with digested evidence, 28 defaulted-with-disclosure, real test run (11/11) recorded | chain pack + `evidence/` |
| 3 PROVE | Served locally, probed raw-http both states: empty store → every answer renders **UNBOUND** (machine-readable); fixture store → bindings carry `fixture:` ids + digests. StoryPack: 4 claims bound to build evidence, 1 unbound **with adjacent disclosure**, 3 withheld, `sources: []` — zero content claims | `proof/mew-migration/serve-probe.json` · chain story pack |
| 4 LAUNCH+LEARN | Placement gate on `convex` **before** use (placement call below); credentials premise tested for real: **cloud deploy exit 1 at login — kill receipt**; LaunchManifest claim `deploy-failed`; ObservationPack 2/8 observed, 6/8 unobserved as first-class reports; zero spend, authority H0 | `proof/mew-migration/convex-deploy-receipt.json` · chain manifest + pack |

### What the build is (the story pack's rendered claims, verbatim)

- The importer refuses loudly and its manifest closes per table: every exported record is imported, refused with a reason, or in a counted, disclosed drop.
- Every migrated row carries sourceId, sourceDigest and importedAt, and every table is enumerable for erasure by sourceId.
- An answer with no source binding renders as UNBOUND; the agent surface has no generative fallback.
- The surface discloses that no notebook data has been imported; the store it answers from holds zero graph nodes.
- The importer accepts the exact JSON shape that Mew's own database exporter writes.
  *The accepted shape is bound to the exporter and schema read from the owner's local personal-dev-mew checkout (digests in proof/mew-migration/local-recon.json), but no real export file has ever been produced or read, and schema drift across the owner's three branches is real and unresolved.*

Withheld, not rendered (each with a reason in the story pack): that the notebook was migrated, that
its contents survived intact, that asking about a topic surfaces the owner's note about it.

## Chain verdict (verbatim; `node src/lib/journey-chain-gate.mjs proof/mew-migration/chain mew-migration`)

    stages 5/5 found
    edges  6/6 bound
    digests 6/6 matched  (checked 6, unresolvable 0)
    caseIds 4 confirmed, 2 asserted-unconfirmable
    files   5 json scanned, 0 not chain artifacts, 0 unreadable
    verdict: PASS (exit 0)

Probed both ways on this same chain: tampered pack digest → FAIL (exit 1, `digest-mismatch`);
partial chain → FAIL (exit 1, `stage-absent` ×3). All five artifacts were produced by scripts that
validate against their schemas before writing and refuse otherwise (each refusal path probed live,
exit 1, nothing written); none carries `approved`, `reviewedBy`, or `promotionAuthorized: true`.

## Test-case scorecard (two columns, never blended)

    deterministic:  PASS — 14/14 checks of the per-table import manifest against the store it
                    produced, on LABELED FIXTURES ONLY (fixture: ids; fixtureLabeled read from
                    the file's own label). This proves the machinery, not the notebook.
    semantic:       NOT_RUN — 3 owner-authored cases HARVESTED (notion-cases.json), 0 evaluated:
                    they exercise agent CRUD orchestration (find/create/move/link) outside this
                    retrieval-only slice, and need a populated graph (owner input #1).
    (never blended; there is no field where a blend could live)

## Artifact digests (canonical JSON sha256, as the chain gate computes them)

    opportunity-contract    fdaf5b0789cb2e31ed2a3976b6f94cefd1f77650205ae45c83742d5d28346765
    build-evidence-pack     daee8a8b4d28e99ecb4ec426b4b45b47178f4c1e9a7c6f49c0bd631a8852891c
    story-pack              e88d8cc2d6a3af02fe8398a23b250c6dd779c879481dc33133ae7ee07d4d39ba
    launch-manifest         d8f39de275132d6aea56cee330db765e42b9f2270757afbb77a3cb865f2266d7
    observation-pack        6595827c83d5a99f9a1f82782d37a53fb0e8fde6ae811f455f1fcbf146a94c6e

## Awaiting your countersignature / action (complete)

1. **Every defaulted decision** — 28 contract pointers defaulted-with-disclosure
   (`proof/mew-migration/chain/evidence/default-disclosures.md`), plus the structural calls in the
   importer: bound to the personal-dev-mew schema (drift refuses loudly), dedup by id within one
   export (first kept, duplicates refused), whole-table drops `users`/`data` counted with reasons,
   field drops `pk`/`content_tsvector` recorded. Countersign or redirect.
2. **Owner input #1 (one command now)** — run `yarn tsx scripts/export-database.ts <dir>` in
   `personal-dev-mew/mew` and hand over the JSON; the real import, inventory, and deterministic
   column on real data all follow immediately.
3. **Owner input #3 (evaluation gating)** — the 3 harvested MewAgent cases: say whether they gate
   this retrieval slice (then the CRUD toolset is next scope) or the future agent slice; or author
   retrieval-shaped cases for the current surface.
4. **Owner input #2** — `npx convex login` (or a deploy key); then `npx convex deploy` and the
   rendered-DOM probe re-run. The schema half is already proven against a real local backend
   (ten indexes accepted).
5. **Placement calls** — the two flagged in [PR #25](https://github.com/HomenShum/node-platform/pull/25)'s
   body, plus one new from this run: `convex-backend` is registered **[ADAPTER], not [APP]**,
   because the platform itself ships a Convex component and already carries convex as an optional
   peer + dev dependency — an APP placement fails the dependency-free-core gate against reality.
   The gate stayed strict; the declaration moved. Countersign or overrule.
6. Review PRs #24–#27 — all green-gated, **none merged**, per the merge-nothing rule; this branch
   cherry-picked #24 (producer) and #25 (registry+gate) to build on them, and supersedes #26/#27's
   conclusions as recorded above without touching their receipts.
