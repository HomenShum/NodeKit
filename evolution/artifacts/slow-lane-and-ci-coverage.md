# The slow test lane, and the CI gate the split nearly dropped

Captured 2026-07-26. Every number below came from a command that ran.

## THE COST WAS 1-BIT PNG DECODING, NOT FILE I/O

`test/agent-ease-matrix.test.mjs` could not finish. Measured before any change, with a stray-process
check returning zero first:

    timeout 1200 npm run test:slow
      exit 124 (killed at the ceiling)
      1,200,089 ms
      4 of 6 tests reached, 1 failing

Profiled on the real 11,194-file fixture, `scripts/evaluate-agent-ease.mjs` took 366.34s for one
invocation, of which **pngjs self time was 275.26s — 75.1%**. All filesystem work was 8.1s, **2.2%**.

Root cause is two bytes in `test/submission-fixtures.mjs` `browserPng`: it wrote `bitDepth=1`,
`colorType=0`. pngjs decodes any image whose bitDepth is not 8 through a per-pixel path.

    ihdr[8] = 1  ->  8      bitDepth
    ihdr[9] = 0  ->  2      colorType, truecolour
    stride = ceil(width/8)  ->  width * 3
    deflateSync(raw, { level: 9 })  ->  { level: 1 }

Level 1 is part of the fix, not a garnish: at level 9 encoding costs 1.8s per 180-image manifest
against 0.32s at level 1, and a fixture-cache miss pays it twice.

### AFTER

    timeout 1200 npm run test:slow
      exit 0
      500,411 ms  (8m20s)
      6 of 6 tests pass

From "cannot complete in 20 minutes with a failure" to "8m20s, fully green".

## FOUR WRONG HYPOTHESES, RECORDED SO THEY ARE NOT RE-TRIED

Each was measured and each was wrong. The correct answer was found only by profiling.

    npm pack                     2.4s x 6 invocations — real, but 14s of 366s
    npm archive inspection       42ms per call
    PNG validation               probe called the validator with the wrong signature; it
                                 returned instantly on zero work, so its numbers meant nothing
    lock contention              filesystem work is 2.2% of runtime
    "spread across ~11k file
     operations at ~40ms each"   REFUTED by the profile

## NO CHECK WAS WEAKENED, AND THAT IS MEASURED

Across four real viewport geometries including the narrowest 390px one:

    IHDR                 bitDepth=8 colorType=2
    decoded              16/16
    distinct file bytes  16/16
    distinct decoded px  16/16
    uniformly blank      0
    largest png          31,026 bytes   against MAX_SCREENSHOT_PNG_BYTES of 25 MiB

Both hash families still discriminate every image, so the compressed-byte reuse check
(`protected-browser-evidence.mjs:250`), the decoded-pixel reuse check (`:257`) and the `pixelSha256`
binding all keep their power. `submission-gate.mjs:1364` has always accepted bitDepth 8 with
colorType 2 or 6, so no validator changed. Real production screenshots are already depth-8
truecolour, so the fixture now resembles what the gate sees in the field rather than diverging from
it.

`pngFixtureCache` was also bounded at 512 entries with oldest-first eviction. Its key carries a
per-image marker, so every image was a new entry that retained a compressed IDAT, with no eviction.

## THE GATE THE SPLIT NEARLY DROPPED

Splitting the suite changed what `npm test` runs. `.github/workflows/quality.yml` ran `npm test`, so
**CI stopped gating the acceptance lane the moment the split landed** — the precise failure the
split's own commit message warned about, caused by that same commit. The workflow now runs
`npm run test:all`.

`.github/workflows` is a material path, which is why this artifact exists.

## WHAT THIS DOES NOT ESTABLISH

- No clean unprofiled baseline for a single evaluator invocation. The 366.34s figure INCLUDES
  `--cpu-prof` overhead, so the profiler's share of it is unquantified. The 1,200,089ms and 500,411ms
  lane numbers are unprofiled and are the ones to trust.
- The fast lane's own wall-clock is still unmeasured. A probe assigned to produce the per-file table
  died on a 529 API error, so the files owning the 48.6s, 43.8s and 23.8s tests remain unidentified.
- Nothing here shows the 15-trial matrix NEEDS 180 images per manifest at true viewport pixel
  counts. Shrinking the geometry would beat any encoding change and would also reduce the viewport
  coverage the gate exists to prove. That is a decision, not a refactor, and it was not made.
