# Note-surface direction — extracted, not admired

Owner direction, 2026-07-29: NodeKit's note surfaces should follow Ideaflow/Mew's convention. This
records what that convention actually *is*, as facts with locators, so a generated app inherits a
mechanism rather than an adjective.

## Where the evidence came from, strongest first

**Mew's own source.** `D:/VSCode Projects/Ideaflow/personal-dev-mew` is on this disk, read-only.
That beats any screenshot: the token layer is `src/app/global.css` (259 lines) and it is measurable —
a 12-step teal ramp anchored at `--teal-9: #2d95a9`, base `--almost-black: #0d1212`, **seven** type
steps (11/12/13/14/16/18/32px), three shadow tokens all under 8px blur at 0.05–0.067 alpha, and
breakpoints at 450px and 960px. One finding only source could give: **the chrome grays are teal-tinted**
(`#7f8b8b` / `#667373`), not neutral — the achromatic layer shares the accent's hue.

**The owner's two screenshots (M2).** Desktop + iOS, cross-checked against the source. Notes are
separated by a divider and nothing else; hashtags and links are the only colored things in body text;
onboarding content is *ordinary notes in the stream*, not a modal tour; mobile is the same single
column with a persistent mic+compose pair and no bottom tab bar.

**Mobbin (M1/M2 comparators).** Searched by *problem*, not by app name. It returned no Roam screens —
recorded as a coverage boundary, not substituted — but it did return what mattered more: **Evernote's
three-pane chrome** (14 rail destinations, bordered note cards, capture gated behind a Note/Task/Event
choice) and **Fabric's document-modal** reading mode. Those are the counterexamples that make the
rules falsifiable.

## The three rules

| rule | mechanism | tier |
|---|---|---|
| `stream-not-chrome` | every visual boundary and pre-capture decision is friction paid *during* writing; one divider-separated column spends the whole budget on zero-to-first-keystroke | M2, medium |
| `single-accent-inline` | when color appears only where it encodes meaning, color becomes a reliable retrieval signal — a teal token *is* a tag, everywhere | M2, medium |
| `capture-always-armed` | capture value decays in seconds; deferring classification moves that cost to after the thought is safe | M2, high |

Each carries `doesNotApplyWhen`, drawn from the counterexamples: long-form documents with heading
hierarchy (Fabric), retrieval-at-scale workloads (Evernote), and compliance intake where
classification is legally prior.

## What landed in the template

Additive tokens only, in `templates/base/apps/web/public/styles.css` — `--stream-max-width`,
`--stream-rail-width`, `--stream-divider`, `--stream-note-gap`, the two measured breakpoints, and
`--tag-token-*`. **No existing surface was restyled.** Each line cites its observation id inline, so
the provenance travels with the code instead of living in this document.

## What was NOT adopted, and why

- **Mew's literal palette.** The template keeps its own `--violet` accent; the *rule* transfers (one
  accent, inline-only), not the hue. Copying `#2d95a9` would make every generated app look like Mew.
- **A 12-step ramp.** The template has no state-heavy surfaces needing one yet. Adding it before a
  consumer exists is the scaffold-diet violation the plan already ruled against.
- **Roam-specific patterns.** No Roam evidence was obtainable; nothing was inferred from reputation.

## Not observed

**Motion.** No runtime observation of Mew's transitions was made — no `Element.getAnimations()`
capture, no video. So there are zero motion facts here, and that is an absence, not a finding of
"no motion." Closing it requires the `motion-runtime-probe` stage the council sequenced.

**Density.** All Mew evidence is the 8-note sample notebook. Behavior at 1,000+ notes is unobserved.

**Audience-task evidence (M3).** Nobody has been watched capturing a note under either convention.
Until that happens, no rule here may be cited as audience-proven — which is exactly what the
hackathon presentations are for.
