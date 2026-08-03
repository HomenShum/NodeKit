---
name: nodekit-present
description: Capture a substantial code change, architecture migration, benchmark, release, or completed hackathon application as an editable, evidence-backed presentation. Use when Codex must explain what changed, assemble a judge or reviewer deck, keep presentation material current during development, or drive NodeSlide through its package, CLI, MCP, or host adapter.
---

# NodeKit Present

Turn verified development artifacts into a living presentation. Treat the deck as a projection of the change record, never as an independent source of claims.

Read [the change-story contract](references/change-story-contract.md) before creating or updating presentation artifacts.

## Workflow

1. Classify the change tier. Skip decks for trivial work; use a change card for a narrow fix, a 3-5 slide mini-deck for a major feature, and a full deck plus appendix for releases or hackathons.
2. Create or update `changes/<change-id>/change.yaml`. Record audience, problem, prior state, decision, alternatives, affected systems, user workflow, proof requirements, limitations, and presentation tier.
3. Capture evidence while work happens: baseline and after screenshots, exact commits, deployment identity, tests, benchmarks, traces, artifacts, exports, and known failures. Preserve raw receipts.
4. Build an evidence index. Give every material claim a status and evidence IDs. Label planned, inferred, user-asserted, and measured claims distinctly.
5. Plan each slide before rendering. State its job, audience question, takeaway, narrative role, dominant visual, evidence IDs, density budget, and speaker-note goal.
6. Use the installed NodeSlide transport in this order: repository-native adapter, NodeSlide CLI, NodeSlide MCP, or package API. Inspect capabilities first and never assume hosted writes, export, or approval are available.
7. Propose deck changes against the pinned deck version. Validate, compare, and apply through the host policy; do not bypass NodeSlide governance for convenience.
8. Verify every material claim against the current commit or deployment. Refresh stale screenshots and metrics. Keep limitations visible.
9. Export the requested editable format and reopen it. Verify the rendered deck, speaker notes, source bindings, and any PPTX round trip.
10. Derive the demo script, README section, release notes, and submission copy from the same Change Story and Evidence Index.

## A demo clip is a rendered walkthrough, never a screen recording

This section exists because of a measured failure. A production deploy was verified 11/11 with a
recorded clip, and the clip was a raw Playwright capture: no focus framing, no captions, no visible
streaming or tool calls, no slides. The tooling for every one of those already existed and this
skill named none of it, so it was hand-rolled badly instead of driven well.

**FeatureClipStudio** (`feature-walkthrough-gif/`) is the capture-to-render pipeline, and it covers
the four things a raw capture never has:

| what a raw capture lacks | what the pipeline does |
|---|---|
| focus on what matters | zoom-to-focus camera, animated cursor gliding to each click with a ripple |
| explanation | step captions per state |
| the work being visible | loading and streaming captured LIVE — spinner spinning, results arriving |
| the internals when the claim depends on them | raw JSON/state evidence panels |

```bash
npm run capture   # Playwright drives the live flow and records every UI state
npm run studio    # storyboard the captured states
npm run render    # Remotion renders the walkthrough
npm run judge     # Gemini watches the RENDER and scores it
```

`judge-video.mjs` is the gate, and it is the one to run before calling a clip done. It watches the
rendered MP4 against an anti-hero-shot rubric and returns timestamped defects at P0/P1/P2 — P0
blocks publishing. Its own header states the point: the final cut stops being the one stage only
human eyes ever check. Judge the MP4 rather than the GIF; GIF is not a supported video MIME.

Do not enter a re-render polish loop over P2s the judge already passed.

**NodeSlide** for the deck, **NodeVideo** for frame-level evidence — a frame presented as the
running product must bind to the deployment it came from, and `presentedAs` is what makes that
checkable.

### Where reference videos come from

Mobbin works for UI because it is a corpus you OBSERVE and CITE, never copy. Video needs the same
discipline and splits into two kinds, which are not interchangeable:

**FLOW references — what a real product actually does, step by step.**
[Page Flows](https://pageflows.com) is the direct analogue: recorded user journeys rather than
screenshots, 20,000+ apps, organised by task — sign up, upgrade, cancel — including the consent
dialog, the field validation, the empty state and the success screen. Its own framing is the
anti-hero-shot rule stated from the other side: Mobbin shows you the destination, Page Flows shows
you the trip. [ScreensDesign](https://screensdesign.com) covers onboarding and paywalls with
revenue signals attached. Use these to answer "what states does a real flow of this kind contain,
and which am I skipping?"

**CRAFT references — how a launch film is built.**
[FlowJam](https://www.flowjam.com/library) is hand-curated SaaS and product-launch videos;
[Tella's library](https://www.tella.com/examples/demo-video) and
[Vidico's breakdowns](https://vidico.com/news/best-product-demo-video-examples/) publish examples
with the reasoning attached. Use these for pacing, the single moment, and where motion is doing work
versus decorating.

Do not paste either kind into the rubric as prose. Record them the way a Mobbin observation is
recorded: an atomic fact, with a `locatorDescription` that for video is a TIMESTAMP, cited to the
source URL. The claim is "at 0:12 the loading state is held for 1.4s before the result", not "their
pacing is good". A rule derived from a timestamped observation can be scored; an adjective cannot.

Licence: observe and attribute, never re-host. `licenceMode` in the observation schema is an
enumerated single value on purpose — extending it to a new source class is a licence review and a
deliberate schema edit, not a typed string.

## Parallel lane

For a large implementation, run presentation work as a read-mostly lane beside building and QA. Draft the problem and architecture early; replace placeholders only with verified evidence from later gates. Block release only for unsupported claims, missing required proof, stale evidence, or a broken export.

## Completion language

- Say `drafted` when slide plans exist.
- Say `evidence-bound` when every material claim resolves to current evidence.
- Say `export-verified` only after the requested output reopens successfully.
- Say `release-ready` only when the application proof and presentation proof both pass.

Do not turn a green unit test into a production claim, an HTTP 200 into browser proof, or an advisory model judgment into an authoritative verdict.
