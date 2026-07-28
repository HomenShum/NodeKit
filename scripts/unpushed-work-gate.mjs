#!/usr/bin/env node
/**
 * unpushed-work-gate — refuse to believe "your work is safe" without checking the work.
 *
 * Written 2026-07-27 after a near-miss that this gate would have caught in one line.
 *
 * The failure it exists for: a checkout sitting on `feat/phase4-resurface-parity` was measured with
 * `git rev-parse main`, `git rev-list --count main..origin/main` and `git push origin main`. Every
 * number came back about `main` — a stale local ref nobody had moved in days — and every number was
 * clean:
 *
 *     ahead: 0            true of main, irrelevant to the work
 *     push exit: 1        rejected, a stale ref against an advanced remote
 *     unpushed now: 0     true of main, and the most dangerous line of the three
 *
 * That third line is why this is a gate and not a habit. It does not read like an error. It reads
 * like reassurance, and it is the exact number a person runs to confirm nothing will be lost. The
 * real branch carried 214 lines that `git branch -r --contains` placed on no remote at all.
 *
 * The rule, stated so it cannot be satisfied by the wrong subject:
 *
 *     ASK ABOUT THE COMMIT YOU ARE ON, NEVER ABOUT A BRANCH NAME YOU SUPPLIED.
 *
 * A branch name is an argument the caller chooses. `HEAD` is not. Every check below resolves HEAD
 * first and reports the branch as an observation, never as an input.
 *
 * Exit codes are distinct on purpose — a caller that only knows "non-zero" still fails closed, and
 * a caller that wants to tolerate a dirty tree but never tolerate unreachable work can tell them
 * apart.
 *
 *     0  HEAD is reachable from at least one remote branch
 *     1  HEAD is on no remote — this work exists on one disk
 *     2  tracked files are modified — a measurement here describes a tree nobody can ship
 *     3  not a git repository, or git failed
 *
 * Usage:
 *     node scripts/unpushed-work-gate.mjs [--repo <path>] [--json] [--allow-dirty]
 */

import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

const repo = value('--repo', process.cwd());
const asJson = flag('--json');
const allowDirty = flag('--allow-dirty');

/** Run git and return trimmed stdout, or null if git itself failed. */
function git(...args) {
  try {
    return execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

const head = git('rev-parse', 'HEAD');
if (head === null) {
  const msg = `not a git repository (or git failed): ${repo}`;
  console.error(asJson ? JSON.stringify({ ok: false, code: 3, reason: msg }) : `FAIL  ${msg}`);
  process.exit(3);
}

// Observed, never supplied. On a detached HEAD this is literally "HEAD", which is itself worth
// printing — a detached checkout is one of the ways work goes unreachable without looking wrong.
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
const detached = branch === 'HEAD';

// The load-bearing question. `--contains <sha>` asks whether this exact commit is an ancestor of
// any remote-tracking branch. It cannot be satisfied by a same-named branch that points elsewhere,
// which is precisely how the near-miss produced a clean number.
const containing = (git('branch', '-r', '--contains', head) ?? '')
  .split('\n')
  .map((l) => l.trim().replace(/^\* /, ''))
  .filter(Boolean)
  // `origin/HEAD -> origin/main` is a symbolic ref, not a branch that holds anything.
  .filter((l) => !l.includes('->'));

// Only tracked modifications count. Untracked scratch files are normal working debris and failing
// on them would make this gate noisy enough to get switched off, which is how gates die.
const porcelain = (git('status', '--porcelain', '--untracked-files=no') ?? '')
  .split('\n')
  .filter(Boolean);

const reachable = containing.length > 0;
const dirty = porcelain.length > 0;

let code = 0;
let reason = 'HEAD is reachable from a remote';
if (!reachable) {
  code = 1;
  reason = 'HEAD is on NO remote — this work exists on one disk';
} else if (dirty && !allowDirty) {
  code = 2;
  reason = `${porcelain.length} tracked file(s) modified — this tree is not what any remote holds`;
}

const result = {
  ok: code === 0,
  code,
  reason,
  repo,
  head,
  branch: detached ? '(detached)' : branch,
  detached,
  remoteBranchesContainingHead: containing,
  modifiedTrackedFiles: porcelain.length,
};

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(code);
}

const label = code === 0 ? 'PASS' : 'FAIL';
console.log(`${label}  ${reason}`);
console.log(`      repo   ${repo}`);
console.log(`      HEAD   ${head.slice(0, 12)}  on ${result.branch}`);
console.log(
  `      remote ${reachable ? containing.join(', ') : '(none — git branch -r --contains HEAD is empty)'}`,
);
if (dirty) console.log(`      dirty  ${porcelain.length} tracked file(s) modified`);

if (code === 1) {
  console.log('');
  console.log('      Nothing on any remote holds this commit. Push the branch you are actually on:');
  console.log(`          git -C "${repo}" push -u origin ${detached ? '<branch>' : branch}`);
  console.log('      Then re-run this gate. Do not verify with a push exit code alone — capture it');
  console.log('      on its own line, never through a pipe, and confirm by content afterwards.');
}

process.exit(code);
