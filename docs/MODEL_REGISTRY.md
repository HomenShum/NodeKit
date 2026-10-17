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
| `.github/workflows/model-bump.yml` | humans | reusable workflow a consumer calls by 40-hex SHA: a read-only `check` job (runs the consumer's own gate, last) and a `write` job (runs none of the consumer's code) |

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
  opens nothing. A dated deprecation row (announced or expiration) carries the window it is in, `horizon: 90`, `30`
  or null, so a date crossing the 90-day or the 30-day line changes the decision set and opens a PR with no input
  change, also on a line that is already held (where neither `status` nor the date moves).
- **Triggers.** A state outside active/listed, or an announced date within 90 days, makes the incumbent a
  trigger. It moves only to the vendor-named replacement, and only if that entry is `reviewed`, has an id for
  every transport the line is used on, and is eligible on each. Otherwise the line is `held-no-replacement` and
  the PR body asks a human. A date within 30 days makes the incumbent ineligible. The replacement is held to the same
  eligibility test (state active/listed, no date within 30 days), not to the trigger test: one that itself retires in
  31-90 days still qualifies. After a move the new current is judged in the same run: if it triggers and the vendor
  names nothing after it, the line is `held-no-replacement` at once, so the merged move leaves nothing for the next
  run to change.
- **The robot never proposes what its own validation rejects.** A `current` must carry a release date, and, on a line
  that routes through OpenRouter (the only catalog the bot reads prices and context windows from), a price and a
  context window. A replacement that lacks them is not adopted: the line is held with a row naming the missing
  fields, which a human records (a price or context window recorded from a vendor page uses the transport's own name
  as `source`, for example `anthropic`, and is kept only on an entry with no OpenRouter row to derive one from).
  Hygiene on `current` (a `:batch` or `:free` id, a router alias, a dated Claude id, a `-1` price) looks only at the
  wire ids of the transports the line routes through, so a bad OpenRouter row cannot stop the weekly run of an
  Anthropic-only line.
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
- **A re-laid-out page fails the run, row by row as well as page-wide.** Anthropic: the deprecation-history table
  (which carries the vendor-named replacement) must be found; without it a notice would read as "the vendor names no
  replacement". OpenAI: an id-bearing row count floor (`minIdRows`) for a page that lost all its ids, and per row, a
  name cell with no backticked id that holds an id-shaped token fails (one row that lost its markup would otherwise
  read as "no notice" while 62 others keep the page-wide floor satisfied).
- **No status-only PR.** A merged move leaves the line's status at the value the next run computes, so the week
  after a merge opens nothing.
- **The bot branch is replayed, not only fenced.** The G1 check on `automation/model-registry` runs the field
  allowlist and then `models replay` against the base branch's registry: selection is re-run over the snapshots
  committed on the branch, from the clock in `models/selection-input.json`, and must reproduce `models.yaml` byte
  for byte. A line move with no trigger, an edited release date, or a proposal cut from a registry older than the
  base branch's (it no longer hashes to `selection-input.json`) therefore fails.
- **Consumer jobs.** `model-bump.yml` has two jobs. `check` has `contents: read`, syncs and lints the proposal, and
  runs the consumer's own install and test commands as its last step. `write` has what the caller granted
  (`contents`/`pull-requests` write, or `issues` write for `watch`) and runs none of the consumer's code: it starts
  from a fresh checkout, recomputes the lock with `models sync` from the registry commit `check` used, refuses to go
  on unless that lock's sha256 equals the one `check` computed before the gate ran, then commits and pushes it.
  Everything the gate can reach (its runner files, `$GITHUB_ENV`, `$GITHUB_PATH`, the git config of its user) is
  on a runner `write` never sees.

## Operating it

- First run: Monday after merge, 13:47 UTC. `workflow_dispatch` runs as a dry run unless `dry_run` is set to false.
- Required repo setting in NodeKit and in each consumer: *Allow GitHub Actions to create and approve pull
  requests*. Without it the PR step fails loudly.
- Human-owned edits go in their own PR to `main`; the bot branch is force-pushed and G1 rejects them there.
- If the weekly job stops, `watch` in each consumer says so ("registry refresh not running") because the last
  successful refresh run is older than 14 days. A consumer's own schedule dying cannot be detected from inside it.

Sources and decisions: `D:/VSCode Projects/model-defaults/SPEC-v9.md` Part B and
`_scratch/partb-research/brief.md` (REA + ORX, fetched 2026-10-16).

## Deviations from SPEC-v9 §B

| Where the spec says | What this does | Why |
|---|---|---|
| B.4: a move writes `status: proposed-deprecation` | no such status (removed from the schema); the move is recorded in `previous` and in the PR body, and `status` is the one the next run computes | otherwise every merged move was followed by a status-only PR |
| B.2.1 item 1: a `current` has `releaseDate`, `context` and `price` | `context` and `price` only on a line that routes through OpenRouter, the one catalog the bot reads them from; `releaseDate` always | an Anthropic-only line can never have a bot-derived price, so requiring it made a bad OpenRouter row stop the weekly run |
| B.2.3: replay is a run step | also a step of the G1 check on the bot branch | the field allowlist cannot tell a legitimate move from an edit to an allowed field |
| B.3: a horizon crossing opens a PR | `horizon` (30, 90 or null) is part of each dated deprecation row | on a line already held, neither `status` nor the date changes at a crossing |
| B.5: the consumer declares roles in `nodekit.yaml` | `models.config.json` | the pilot has no `nodekit.yaml`; adopting one pulls it under repo-conformance |
| B.6: one `bump` job | `check` (read-only; runs the consumer's gate last) and `write` (runs none of it) | the consumer's commands can reach whatever the job they run in holds |

## Known limits (v1)

- Discovery of newer ids is Anthropic-only (from the vendor table, filtered by each line's `regex`); OpenAI,
  Google and OpenRouter lines have lifecycle checks but no new-id discovery yet.
- If a vendor reverts a change after the bot opened a PR, the open PR is not closed automatically; a human
  closes it.
- The keyed Anthropic `GET /v1/models` cross-check, lint warnings (d)-(g) and ranking by performance (§B.8) are
  not built. Nothing here uses a provider key.
- A consumer's **role** pins are judged on `main`'s committed `deprecations` (only frozen ids are read live). So a notice
  that appeared this week reaches a consumer's URGENT issue once the registry's refresh PR is merged, not before;
  the open refresh PR is the earlier signal. Reading roles live would make every consumer's daily `watch` depend on
  four vendor pages, so v1 does not.
- `watch` opens or updates one issue; it does not close it when the horizon passes. A consumer's frozen ids (B.9) are
  judged on the four public catalogs fetched during the `watch` run (only when the lock has frozen ids), with the
  same strict parsers, not on the snapshots on `main`: the registry commits a snapshot only when its own decision
  set changes, which a frozen id never causes, so those can be weeks old. If the live fetch fails the run goes red;
  an id on a transport no snapshot covers is listed under "Not checked", never passed.
- **B.1 loading is not wired.** `loadRegistry` / `validateRegistry` in `src/lib/registry.mjs`, the
  `CONTRACT_SCHEMA_FILES` entry, a `models` property in `schemas/nodekit.schema.json` and the
  `nodeplatform.model-defaults` concept in `ownership.yaml` (all SPEC-v9 B.1, not C.3) are deferred: those files are
  also edited by open NodeKit PRs. So `npm run registry:check` says nothing about `models.yaml`; `nodekit models
  validate` (the `model-registry-check` workflow) is what gates it. `CODEOWNERS` for the human-owned paths is C.3
  and is Homen's call.
- The 14-day snapshot-age bound is enforced by the refresh run, not by the PR check. A proposal that waits more than
  14 days for a reviewer is normal, and the check would fail it (a bot PR as much as a human one) with no fact wrong.
  What catches a stale bot PR is the replay: once `main` has moved, the PR's input registry no longer hashes to
  `selection-input.json`; and next week's refresh rebuilds the branch.
- The consumer's bump token has `contents` and `pull-requests` write only. SPEC B.6 also listed `actions: write` and
  `statuses: write` for a dispatch-and-mirror step that is not built (brief D-9: scopes unchanged until the first
  pilot PR shows whether the "Approve workflows to run" banner appears). Consequence: the bot PR shows no CI until a
  human approves its runs; that is the thing to record from the first real PR.
- A consumer's own schedule dying cannot be detected from inside that consumer.
