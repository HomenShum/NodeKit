# Consumer package verification is lifecycle-free

Observed on Windows with npm 10.9.4 and npm 11.7.0:
`npm pack --ignore-scripts` still ran the package `prepare` lifecycle. NodeKit's
reduced independent source copy omitted `scripts/clean-component-dist.mjs`, so
the documented consumer preparation path failed with `MODULE_NOT_FOUND` before
it could compare an otherwise valid exact archive.

The verifier no longer starts an npm process. It derives a bounded canonical
manifest directly from the clean, tracked distribution selected by
`package.json#files`, then compares name, version, file count, unpacked byte
count, and the complete path/size/SHA-256 manifest identity with the supplied
archive parsed by NodeKit's non-extracting archive verifier. Candidate commit,
source hash, cleanliness, and tracked-file equality are rechecked around the
comparison.

The regression fixture declares the same missing prepare helper as the real
package. It fails on the predecessor implementation and passes after the
change without writing consumer outputs or executing any lifecycle.

Evidence:

- `evidence/consumer-package-prepare-lifecycle/before.txt`
- `evidence/consumer-package-prepare-lifecycle/after.txt`
- `test/consumer-package-preparation.test.mjs`

Boundary: this proves package preparation only. It does not publish npm,
deploy a consumer, or satisfy authenticated Convex adoption.
