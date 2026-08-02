# Changelog - NodeKit onboarding documentation

> **Surface**: Newcomer orientation from an idea to the smallest useful, proof-carrying product.
>
> **Append rule**: New entries go at the top and released entries are never rewritten.

## 2026-08-02 - Route launch agents through the field card

Require the bundled `nodekit-launch` skill to read the 90-second idea-to-reality field card before
the detailed launch contract. Preserve progressive disclosure by opening deeper principles only
when their trigger matches the current decision. A public-package scenario test binds the agent
entry point to the same manual humans reach from README and START_HERE.

**Commit**: `this commit`. **Author**: Codex.
**Touches**: `plugins/nodekit/skills/nodekit-launch/SKILL.md`, `test/public-api.test.mjs`

## 2026-08-02 - Publish the idea-to-reality principles

Distill the NodeSlide, NodeVideo, and NodeVision field sessions into one layered NodeKit manual
covering product boundaries, UI and system complexity budgets, human/agent authority, durable
continuity, causal failure repair, model routing, proof, distribution, and learning. Keep a
90-second field card first, with deeper decision rules and reusable records behind it. Link it from
both onboarding entry points and replace a brittle documentation-file count with a timeless
description.

**Commits**: `1ec3cb4`, `this commit`. **Author**: Codex.
**Touches**: `CHANGELOG/package/public-docs.md`
