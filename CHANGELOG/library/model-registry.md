# Changelog - model registry (`src/lib/model-*.mjs`, `nodekit models`)

> **Surface**: the reviewed list of exact model ids, its weekly proposal-only refresh, and the consumer lock.
>
> **Append rule**: New entries go at the top and released entries are never rewritten.

## 2026-10-16 - Add the model registry pilot (Part B v1)

Adds `models.yaml`, four public catalog snapshots, `nodekit models snapshot | validate | select | replay |
pr-guard | sync | lint | watch`, a weekly proposal-only refresh workflow, a G1 check and a reusable consumer
workflow. The first consumer is NodeRL (`models.lock.json`). Every parser throws on an unrecognised page so a
layout change fails the run instead of reading as "nothing is deprecated". Scenario tests cover a retired
incumbent, a newly released successor, a missing catalog field, an unchanged catalog on a new date, network
failure, a hostile redirect, scale, 52 sustained weekly cycles and the closed-PR guard.

**Commit**: `this commit`. **Author**: Claude.
**Touches**: `docs/MODEL_REGISTRY.md`
