#!/usr/bin/env node
/**
 * Backward-compatible entrypoint for the original motion-token drift gate.
 *
 * The product surface now lives at:
 *
 *   node src/cli.mjs motion compare <repoA> <repoB> [repoC ...]
 *
 * Keeping this wrapper matters because existing notes and local automation call
 * the script directly. Both routes use the same implementation and receipt, so
 * the documented gate cannot silently diverge from the shipped command.
 */

import { compareMotionPortability } from "../src/lib/motion-portability.mjs";

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const repositories = argv.filter((argument) => !argument.startsWith("--"));

if (repositories.length < 2) {
  const result = await compareMotionPortability(repositories);
  if (asJson) console.log(JSON.stringify(result, null, 2));
  else {
    console.error(
      "NOT_RUN  motion-token-drift-gate needs at least two readable repositories; not-run is never a pass.",
    );
  }
  process.exit(result.exitCode);
}

const receipt = await compareMotionPortability(repositories);
if (asJson) {
  console.log(JSON.stringify(receipt, null, 2));
  process.exit(receipt.exitCode);
}

const files = receipt.coverage.repositories.reduce(
  (total, repository) => total + repository.cssFilesRead,
  0,
);
console.log(`${receipt.verdict}  motion token portability`);
console.log(
  `      ${receipt.coverage.readableRepositories}/${receipt.coverage.repositoriesRequested} repositories; ${files} CSS files; ${receipt.coverage.declarationsObserved} declarations; ${receipt.coverage.distinctTokenNames} token names`,
);
for (const repository of receipt.coverage.repositories) {
  console.log(
    `      scanned ${repository.repositoryId}: ${repository.cssFilesRead} file(s), ${repository.declarationsObserved} declaration(s), source ${repository.sourceSetSha256.slice(0, 12)}`,
  );
}
for (const conflict of receipt.conflicts) {
  console.log("");
  console.log(`      ${conflict.token} (${conflict.scope}):`);
  for (const observed of conflict.values) {
    console.log(`          ${observed.value.padEnd(12)} ${observed.sites.join(", ")}`);
  }
}
console.log("");
console.log(
  `      migration: ${receipt.migration.summary.behaviorPreservingAliases} preserving aliases; ${receipt.migration.summary.reviewRequiredValueChanges} value changes for review; ${receipt.migration.summary.ownerDecisions} owner decisions`,
);
console.log(
  "      boundary: static declarations only; runtime, DOM/trace, video, and audience evidence not run",
);

process.exit(receipt.exitCode);
