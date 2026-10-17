# Changelog - model registry (`src/lib/model-*.mjs`, `nodekit models`)

> **Surface**: the reviewed list of exact model ids, its weekly proposal-only refresh, and the consumer lock.
>
> **Append rule**: New entries go at the top and released entries are never rewritten.

## 2026-10-16 - Fix the pilot after adversarial review (round 2)

The consumer's own install and test commands no longer share a job with the write token: `model-bump.yml` is a read-only
`check` job (the gate is its last step) and a `write` job that runs none of the consumer's code, recomputes the lock and
refuses to push unless it is the one the gate ran on. The weekly refresh no longer stops when the data it produced is
incomplete: a replacement without a release date (or, on an OpenRouter line, a price and context) is held with a row
naming the gap, and a bad OpenRouter row cannot stop an Anthropic-only line; a human can now record a price or context
window under the transport's name. `watch` judges a consumer's frozen ids on the catalogs fetched now. The Anthropic
history table and every OpenAI model row are checked, not just the page. A date crossing the 90 or 30-day line changes
the decision set (`horizon` on dated deprecation rows). A replacement that itself retires is held in the same run. The
G1 check on the bot branch replays selection. The refresh job puts `GH_TOKEN` on the steps that need it only, and
the consumer PR body carries release and per-transport lifecycle facts.

**Commit**: `this commit`. **Author**: Claude.
**Touches**: `docs/MODEL_REGISTRY.md`

## 2026-10-16 - Fix the pilot after adversarial review (round 1)

The consumer workflow no longer hands its write token to the consumer's own install and test commands: `GH_TOKEN`
is set per step, the gate runs without it, and the pull request is committed and pushed from a fresh repository.
Lint rule (a) now compares the lock with the registry at the commit the lock pins, so it can fail on a pull request.
A reformatted OpenAI page that loses its model ids is refused (`minIdRows`). `watch` checks a consumer's frozen ids
against the registry's snapshots. A consumer lock carries only its own transport's availability and price. A hand
edit of a bot-owned derived field fails validation (baseline integrity). A merged move no longer leaves a
status-only follow-up PR, a replacement is held to the 30-day eligibility test, a row that stops giving a price
clears the OpenRouter price, and the consumer PR body quotes the snapshot hashes from the fetched `index.json`.
The removed `proposed-deprecation` status and the unreachable snapshot-shrink check in `validateModels` are gone.

**Commit**: `this commit`. **Author**: Claude.
**Touches**: `docs/MODEL_REGISTRY.md`

## 2026-10-16 - Add the model registry pilot (Part B v1)

Adds `models.yaml`, four public catalog snapshots, `nodekit models snapshot | validate | select | replay |
pr-guard | sync | lint | watch`, a weekly proposal-only refresh workflow, a G1 check and a reusable consumer
workflow. The first consumer is NodeRL (`models.lock.json`). Every parser throws on an unrecognised page so a
layout change fails the run instead of reading as "nothing is deprecated". Scenario tests cover a retired
incumbent, a newly released successor, a missing catalog field, an unchanged catalog on a new date, network
failure, a hostile redirect, scale, 52 sustained weekly cycles and the closed-PR guard.

**Commit**: `this commit`. **Author**: Claude.
**Touches**: `docs/MODEL_REGISTRY.md`
