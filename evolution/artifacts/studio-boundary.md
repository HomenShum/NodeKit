# A boundary, not a second platform

A proposal arrived to extract the UI system as a standalone product, "NodeKit Studio", naming five
components: Atlas, the Frontend Tournament, an independent visual review, evidence verification, and
model routing. Every one of them already shipped in this repository.

That is the fifth time a proposal turned out to be substantially built here under other names. The
expensive failure in this repository has never been missing capability; it is rebuilding capability
that already exists because nothing declares where it lives.

## What was actually missing

An edge. Nothing said where the UI surface stops and the rest of NodeKit begins, so the standalone
claim could not be tested and the proposed comparison benchmark had nothing to point at.

`src/studio.mjs` declares that edge and re-exports the shipped implementations. No file moved and
nothing was forked. The repository already had the pattern: the Caseflow package entrypoint is a
barrel over `src/lib` with an export subpath, and the Studio surface follows it.

A test asserts the boundary owns exactly one function of its own, so a future fork fails rather than
quietly becoming a second implementation of a capability that already exists.

## Deliberately not a separate repository

The extraction rule adopted here is to package inside this repository and split only once NodeSlide,
NodeVideo, the Verified Business Copilot, and one external application all consume the same surface.
A second repository before its consumers share one implementation boundary is a premature second
platform, which is the failure this record exists to prevent repeating.

## Honest gaps, declared in the loop itself

`STUDIO_LOOP` declares all ten steps with an implemented flag. Two are false on purpose:

- `edit` has no implementation anywhere in this repository. It is the largest genuine hole.
- `search` has no reference ingestion. Atlas stores references and the research collector has
  generic providers, but nothing pulls an external design reference in.

`studioCapability()` derives readiness from those gaps, so it cannot report standalone readiness
while one is open, and it carries unproven claims separately from missing ones.

## Known limitations

- This adds no capability. It is a declaration, and a declaration cannot make an unrun benchmark run.
- The comparison benchmark (raw prompt / contract / contract with Atlas / full Studio) has never
  been executed, so no token or repair-round advantage is demonstrated.
- The frontend tournament has never run end to end against a real generated application.
- The fielded Atlas ranker remains unproven against a structured baseline.
- Nothing here certifies any application. EASE_NOT_CERTIFIED stands.
