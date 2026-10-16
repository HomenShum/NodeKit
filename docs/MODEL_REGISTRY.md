# Model registry: keeping default models current

**The situation.** A maintainer ships an app whose default AI model is a name typed into code, for example
`claude-haiku-5-5`. Vendors announce retirements on web pages. Nobody re-reads those pages, so one day the
default stops answering. The failure to design against is not only "the model died": it is also a robot that
quietly stops running, or misreads a page and reports "nothing is retiring".

**What this does.** Once a week a robot reads four public, keyless catalogs (OpenRouter's model list and the
Anthropic, OpenAI and Google deprecation pages), compares them with one reviewed list of exact model ids
(`models.yaml`), and, only when a decision-relevant fact changed, opens one pull request. A person merges. A
consumer repo keeps a small `models.lock.json` copied from that list; its own weekly job proposes lock changes
the same way. Nothing merges itself, no provider key is used and no paid model call is made.

**One-sentence version.** A weekly, proposal-only robot keeps a reviewed list of exact model ids current from
public vendor pages and asks a human to merge the change.

## Files

| Path | Owner | Role |
|---|---|---|
| `models.yaml` | humans: `constraints`, `reviewed`, `sdkSupport`, `lines.*.regex`, `lines.*.transports`, `roles`; the bot: everything else | the registry |
| `models/snapshots/latest/*` | bot | the four catalogs as fetched, with `index.json` (sha256, fetch time, row count) |
| `models/selection-input.json` | bot | the fixed clock and input hashes a replay needs |
| `schemas/nodeplatform.models.v1.schema.json` | humans | shape of `models.yaml` |
| `src/lib/model-catalogs.mjs` | humans | fixed source list, bounded fetch, one strict parser per source |
| `src/lib/model-registry.mjs` | humans | select, validate, decision set, digest, bot-diff allowlist, closed-PR guard, PR body |
| `src/lib/model-lock.mjs` | humans | consumer lock: sync, lint, watch |
| `.github/workflows/model-registry-refresh.yml` | humans | the weekly refresh (Monday) |
| `.github/workflows/model-registry-check.yml` | humans | G1 on any PR that touches the registry |
| `.github/workflows/model-bump.yml` | humans | reusable workflow a consumer calls by 40-hex SHA |

## Commands

```
nodekit models snapshot            # fetch the four catalogs; any failure leaves the committed set untouched
nodekit models validate            # schema, references, hygiene, snapshot integrity, eligibility (G1)
nodekit models select --write      # compute the proposal (B.4); prints whether the decision set changed
nodekit models replay              # re-run selection from the same inputs and clock; must match byte for byte
nodekit models pr-guard            # has a human already closed this exact proposal?
nodekit models sync | lint | watch # consumer side
```

## Rules that decide a PR

- **Decision set vs provenance.** `entries`, `lines`, `roles` and `deprecations` (minus every `checkedAt`) are
  the decision set. A PR opens only when it differs from `main`. A new date, a re-fetch or a changed digest alone
  opens nothing. A deprecation date crossing the 90-day line does open one, with no input change.
- **Triggers.** A state outside active/listed, or an announced date within 90 days, makes the incumbent a
  trigger. It moves only to the vendor-named replacement, and only if that entry is `reviewed`, has an id for
  every transport the line is used on, and is eligible on each. Otherwise the line is `held-no-replacement` and
  the PR body asks a human. A date within 30 days makes the incumbent ineligible. The replacement is held to the same
  eligibility test (state active/listed, no date within 30 days), not to the trigger test: one that itself retires in
  31-90 days still qualifies and is moved again, with its own proposal, when its time comes.
- **A floor is not a retirement.** Anthropic's "Not sooner than <date>" is recorded and watched. It never moves
  a default, also after it has passed with no notice.
- **Soak.** A newer reviewed id is `soaking` for 14 days from its release date (no date: soaks until one is
  recorded), then listed as available. v1 never moves `current` on availability alone.
- **Fail closed.** A fetch failure, a re-laid-out page (missing header, unknown state, unreadable date), fewer
  than half the previous row count, or snapshots older than 14 days aborts the run with a non-zero status. It
  never reads as "nothing is deprecated".
- **Closed means closed.** Every bot PR body ends with a marker holding the sha256 of its decision set. If the
  newest closed-unmerged PR on the bot branch carries the same hash, the run logs `suppressed: closed by human`.
- **Prices** are valid only on the transport that priced them (`price.source`), never copied across transports.
  A consumer lock carries its role's own transport only: availability of that transport, and a price only when that
  transport priced it, so an OpenRouter-only change never opens a PR for an Anthropic-routed role. A row that stops
  giving a price clears the OpenRouter price instead of leaving the old one standing as verified.
- **Baseline integrity (B.2.1 item 5).** The bot-owned derived fields (`availability`, `price`, `context`,
  `supportedParameters`, `deprecations`) must equal what the recorded snapshots give, so a hand edit, or a deleted
  deprecation row, fails `models validate` on any PR.
- **A re-laid-out OpenAI page** that still parses into rows but names (almost) no model id fails the run: the
  id-bearing row count has its own floor (`minIdRows`), because a page without ids reads as "nothing deprecated".
- **No status-only PR.** A merged move leaves the line's status at the value the next run computes, so the week
  after a merge opens nothing.

## Operating it

- First run: Monday after merge, 13:47 UTC. `workflow_dispatch` runs as a dry run unless `dry_run` is set to false.
- Required repo setting in NodeKit and in each consumer: *Allow GitHub Actions to create and approve pull
  requests*. Without it the PR step fails loudly.
- Human-owned edits go in their own PR to `main`; the bot branch is force-pushed and G1 rejects them there.
- If the weekly job stops, `watch` in each consumer says so ("registry refresh not running") because the last
  successful refresh run is older than 14 days. A consumer's own schedule dying cannot be detected from inside it.

Sources and decisions: `D:/VSCode Projects/model-defaults/SPEC-v9.md` Part B and
`_scratch/partb-research/brief.md` (REA + ORX, fetched 2026-10-16).

## Known limits (v1)

- Discovery of newer ids is Anthropic-only (from the vendor table, filtered by each line's `regex`); OpenAI,
  Google and OpenRouter lines have lifecycle checks but no new-id discovery yet.
- If a vendor reverts a change after the bot opened a PR, the open PR is not closed automatically; a human
  closes it.
- The keyed Anthropic `GET /v1/models` cross-check, lint warnings (d)-(g) and ranking by performance (§B.8) are
  not built. Nothing here uses a provider key.
- `watch` opens or updates one issue; it does not close it when the horizon passes. A consumer's frozen ids (B.9) are
  checked against the registry's snapshots (fetched only when the lock has frozen ids); an id on a transport no
  snapshot covers is listed under "Not checked", never passed.
- **B.1 loading is not wired.** `loadRegistry` / `validateRegistry` in `src/lib/registry.mjs`, the
  `CONTRACT_SCHEMA_FILES` entry, a `models` property in `schemas/nodekit.schema.json` and the
  `nodeplatform.model-defaults` concept in `ownership.yaml` (all SPEC-v9 B.1, not C.3) are deferred: those files are
  also edited by open NodeKit PRs. So `npm run registry:check` says nothing about `models.yaml`; `nodekit models
  validate` (the `model-registry-check` workflow) is what gates it. `CODEOWNERS` for the human-owned paths is C.3
  and is Homen's call.
- The 14-day snapshot-age bound is enforced by the refresh run, not by the PR check (it would only block human edits).
- The consumer's bump token has `contents` and `pull-requests` write only. SPEC B.6 also listed `actions: write` and
  `statuses: write` for a dispatch-and-mirror step that is not built (brief D-9: scopes unchanged until the first
  pilot PR shows whether the "Approve workflows to run" banner appears). Consequence: the bot PR shows no CI until a
  human approves its runs; that is the thing to record from the first real PR.
- A consumer's own schedule dying cannot be detected from inside that consumer.
