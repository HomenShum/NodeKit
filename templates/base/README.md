# __APP_TITLE__

__BRIEF_TEXT__

This is NodeKit's domain-blank base application. Its domain is intentionally unspecified; its product behavior is already figured out.

```text
Case -> Run -> Stage -> Artifact -> Proposal -> Approval -> Receipt
```

## Quickstart

```bash
npm install
npm run compile
npm run demo
npm run check
npm run dev
```

Open `http://127.0.0.1:4173`. The deterministic demonstration requires no account, provider key, database, or network connection.

`npm run proof:browser-contract` checks the live HTTP/source-DOM contract. It is deliberately not called browser certification. `npm run proof:browser` drives a real Playwright journey and emits candidate-bound screenshots and metadata; install Chromium with `npx playwright install chromium` when running that certification outside CI.

## Specialize the application

Use [the coding sequence](docs/CODING_SEQUENCE.md) to pin the task's target, baseline, candidate, required cases and evidence. `npm run outcome -- init outcome.json`, `append case.json` and `report` maintain one append-only record with matching HTML and ASCII reports. Missing or failed required cases prevent local completion; review and deployment remain separate.

Start with `docs/FIGURED_OUT.md` and the files in `product/`. Replace the neutral copy, artifact renderer, guided stages, domain tools, validators, and fixtures only after researching the real user journey. Do not replace the proposal, approval, version-conflict, safe-failure, or receipt semantics.

Convex is the preferred first managed backend. The browser consumes NodeKit view models, not Convex documents, so another conforming backend can implement the same observable lifecycle later.


## Review and hand off an actual result

Read `AGENTS.md` first for the canonical artifact contract. Confirm your exact outcome, prepare a proposal, and approve or reject it in the review panel. Rejection preserves the previous canonical artifact. Acceptance records the original submitted text in `content.outcome` and enables **Download proof** for that completed case. The four `data-nodekit-artifact-*` fields on `#artifact` identify the same canonical version and content hash carried by the downloaded `nodekit.portable-proof-bundle/v1` and its `nodekit.receipt/v2` binding.

`npm run compile`, `npm run check`, `npm run demo`, `npm run eval`, `npm run proof:browser-contract`, `npm run proof:browser`, and `npm run proof` replay the local handoff. The browser journey checks the exact input, rejected proposals, contained stale decisions, missing-identity knockouts, download, independent content hashes and reopening in a fresh browser context. A supplied source commit/hash and exact tarball binding are also required for browser certification; an unbound local journey does not become a release approval.

The demonstration stores one case in the local server process. Reload and a fresh browser context reconnect to that same running process. Restarting the server or **Reset demonstration** starts a new case; download the completed proof before either action. `?scenario=...` routes also reset the case to a deterministic fixture and are QA tools, not links to a saved user result. Durable multi-user storage, production, host activation and release authority require their separate gates.
