---
name: nodekit-product-evidence
description: Decide contested roadmap or checklist items with observed product evidence instead of taste — the agent finds the target's demo videos itself, extracts what is on screen through a Gemini product lens, and returns justified / refused-with-trigger verdicts. Use for take-home assignments, competitor or reference-product breakdowns, "should we build X" debates, JD/stack alignment, or any checklist item marked partial that is quietly doing a lot of work. The human supplies a brief, never links.
---

# NodeKit Product Evidence

A contested build decision is settled by what a real product visibly does, not by argument.
Born in the Cheiron take-home: three checklist items sat at "partial, arguably fine" until two
demo videos were watched through a product lens — two flipped to justified by what was on
screen, one was REFUSED and the refusal recorded a trigger instead of building a speculative
gate. The whole loop ran without the human pasting a single link.

## The loop — self-driving, four steps

**1. Derive the search, never ask for links.** From the brief (a company name, a JD, an
assignment PDF, a domain), write the queries yourself: `"<company> demo"`,
`"announcing <product>"`, `"<company> <domain> walkthrough"`. Then let the corpus tooling
search and triage:

```bash
cd feature-walkthrough-gif
node find-references.mjs "Cheiron demo" "Announcing Cheiron Agents"
```

Triage rejects the wrong shapes before spending tokens (a keynote costs 102k prompt tokens
against 3.9k for a short demo). Announcement videos are where new capabilities show;
product demos are where daily UX shows. Take one of each when both exist.

**2. Name the contested items first.** The lens is aimed, not browsed. List the checklist
items you need evidence for — the 🟡 rows, the "arguably fine" ones — before watching
anything. An unaimed watch produces a review; an aimed one produces verdicts.

**3. Extract, verbatim and timestamped.**

```bash
node analyze-reference.mjs --url <found-url> --lens product \
  --competencies "multi-agent specialisation,context compression,human-in-the-loop approval" \
  --label <target>-demo
```

The lens reports only what is ON SCREEN: the product's own words, named features with
timestamps, sources, artifacts, provenance chains, agent selection, input schemas,
write actions, approval UI. `"none observed"` is a first-class answer — it is the answer
that stops a speculative build.

**4. Decide, and record the decision where it binds.**
- **justified** → build it; cite the timestamped evidence in the change story.
- **refused** → do NOT build it. Record the trigger (the observable product change that
  would flip the verdict) as a dated entry in `deferred.yaml` — a deferral is a file a
  submission reads, not a thing someone remembers.
- **unclear** → find one more video, or ship without and say so. Never promote unclear
  to justified because building is fun.

## The two honesty rules

**On-screen-only, overrule-with-reasoning.** The lens verdicts are strictly what appeared on
screen. A builder may overrule one — the take-home justified context compression from
observed multi-turn UX even though no compression UI existed — but the overrule and its
reasoning are written next to the verdict, never silently substituted for it.

**A checklist that got redder got more honest.** When evidence moves an item from 🟡 to ❌,
lead with it. "Partial, arguably fine" hiding a real gap against a real product is the
failure mode this whole skill exists to catch.

## The sibling disciplines it travels with

These were one method in the take-home; use them together:
- **Proof-backed checklist rows** — nothing is marked done on belief; each row names the
  command that re-proves it.
- **Measurement log** — every belief held, measured, and found false gets an entry, ordered
  by what it cost to be wrong about. Wrong first drafts are kept, not rewritten — the error
  is more useful than the corrected number.
- **Audience gate first** (`nodekit audience check`) — read the JD or assignment you already
  hold before inferring a stack from the web; this skill covers what the document cannot:
  what their product actually does.

## Relation to other surfaces

`nodekit-present` finds CRAFT references (how a film is built); this skill finds PRODUCT
evidence (what to build at all). Same corpus tooling, different lens, different question.
Refused items land in the deferral ledger the corpus gate already reads. Calibration runs
(real Cheiron output, reproduced cold) live in `feature-walkthrough-gif/calibration/`.
