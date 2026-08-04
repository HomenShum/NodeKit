import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  opendir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AGENT_RUN_LIMITS,
  contentDigest,
  runAgent,
} from "../src/lib/agent-run.mjs";

const repositoryRoot = path.resolve(".");

async function temporaryStore() {
  return mkdtemp(path.join(tmpdir(), "nodekit-agent-run-"));
}

async function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["src/cli.mjs", ...args], {
      cwd: repositoryRoot,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stderr, stdout }));
  });
}

async function completedRunDirectories(store) {
  const names = [];
  const directory = await opendir(store);
  for await (const entry of directory) {
    if (entry.isDirectory() && /^[a-f0-9-]{36}$/u.test(entry.name)) {
      names.push(entry.name);
    }
  }
  return names.sort();
}

test("researcher wraps a real process and receives exact stdout plus a completed static report", async () => {
  const store = await temporaryStore();
  try {
    const result = await runCli([
      "agent",
      "run",
      "--agent",
      "researcher",
      "--goal",
      "Capture the reproducible result",
      "--out",
      store,
      "--json",
      "--",
      process.execPath,
      "-e",
      "process.stdout.write('experiment=42\\n')",
    ]);
    assert.equal(result.code, 0, result.stderr);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.status, "completed");
    assert.equal(receipt.process.exitCode, 0);
    assert.equal(receipt.io.stdout.text, "experiment=42\n");
    assert.equal(receipt.io.stdout.truncated, false);
    assert.match(receipt.workspaceId, /^ws_[a-f0-9]{64}$/u);
    assert.match(receipt.sessionId, /^session_[a-f0-9]{64}$/u);
    assert.match(receipt.runId, /^[a-f0-9-]{36}$/u);
    assert.equal(receipt.graph.schemaVersion, "nodekit.agent-run-graph/v1");
    assert.equal(receipt.graph.nodes.length, 4);
    assert.equal(receipt.graph.edges.length, 3);
    const { graphDigest, ...graphBody } = receipt.graph;
    assert.equal(graphDigest, contentDigest(graphBody));
    const report = await readFile(receipt.artifactPaths.report, "utf8");
    assert.match(report, /data-testid="agent-run-report"/u);
    assert.match(report, /data-testid="run-status"/u);
    assert.match(report, /data-testid="execution-graph"/u);
    assert.match(report, /data-testid="exact-io"/u);
    assert.match(report, /experiment=42/u);
    const persisted = JSON.parse(await readFile(receipt.artifactPaths.receipt, "utf8"));
    const { receiptDigest, ...body } = persisted;
    assert.equal(receiptDigest, contentDigest(body));
    assert.equal(persisted.graph.schemaVersion, "nodekit.agent-run-graph/v1");
    assert.equal(persisted.graph.nodes.length <= persisted.graph.limits.nodes, true);
    assert.equal(persisted.graph.edges.length <= persisted.graph.limits.edges, true);
    assert.deepEqual(
      persisted.graph.nodes.map(({ id, status }) => ({ id, status })),
      [
        { id: "goal", status: "completed" },
        { id: "process", status: "completed" },
        { id: "evidence", status: "completed" },
        { id: "outcome", status: "completed" },
      ],
    );
    for (const node of persisted.graph.nodes) {
      assert.match(node.startedAt, /^\d{4}-\d{2}-\d{2}T/u);
      assert.match(node.endedAt, /^\d{4}-\d{2}-\d{2}T/u);
      assert.equal(node.evidenceRefs.length > 0, true);
      assert.equal(node.evidenceRefs.length <= persisted.graph.limits.evidenceRefsPerNode, true);
    }
  } finally {
    await rm(store, { recursive: true, force: true });
  }
});

test("failing coding agent preserves stderr and returns the same honest nonzero exit", async () => {
  const store = await temporaryStore();
  try {
    const result = await runCli([
      "agent",
      "run",
      "--agent",
      "repair-agent",
      "--goal",
      "Attempt a repair",
      "--out",
      store,
      "--json",
      "--",
      process.execPath,
      "-e",
      "process.stderr.write('compile failed\\n');process.exit(7)",
    ]);
    assert.equal(result.code, 7);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.status, "failed");
    assert.equal(receipt.process.exitCode, 7);
    assert.equal(receipt.io.stderr.text, "compile failed\n");
    assert.equal(receipt.graph.nodes.find((node) => node.id === "process").status, "failed");
    assert.doesNotMatch(receipt.outcome.summary, /completed\.$/u);
    assert.equal(
      JSON.parse(await readFile(receipt.artifactPaths.receipt, "utf8")).status,
      "failed",
    );
  } finally {
    await rm(store, { recursive: true, force: true });
  }
});

test("degraded process exceeds its budget, is terminated, and still publishes partial evidence", async () => {
  const store = await temporaryStore();
  try {
    const result = await runCli([
      "agent",
      "run",
      "--agent",
      "slow-agent",
      "--goal",
      "Finish within the research budget",
      "--out",
      store,
      "--timeout-ms",
      "1500",
      "--json",
      "--",
      process.execPath,
      "-e",
      "process.stdout.write('started\\n');setInterval(()=>{},1000)",
    ]);
    assert.equal(result.code, 124);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.status, "timeout");
    assert.equal(receipt.graph.nodes.find((node) => node.id === "process").status, "timeout");
    assert.equal(receipt.io.stdout.text, "started\n");
    assert.equal(receipt.limits.timeoutMs, 1500);
    assert.match(
      await readFile(receipt.artifactPaths.report, "utf8"),
      /Timed out/u,
    );
  } finally {
    await rm(store, { recursive: true, force: true });
  }
});

test("adversarial high-volume output remains bounded while total bytes and full digests stay honest", async () => {
  const store = await temporaryStore();
  try {
    const result = await runAgent({
      agent: "load-researcher",
      goal: "Measure a burst without exhausting recorder memory",
      out: store,
      cwd: repositoryRoot,
      program: process.execPath,
      args: [
        "-e",
        "process.stdout.write('x'.repeat(300000));process.stderr.write('y'.repeat(300001))",
      ],
    });
    assert.equal(result.receipt.status, "completed");
    assert.equal(result.receipt.io.stdout.observedBytes, 300_000);
    assert.equal(result.receipt.io.stderr.observedBytes, 300_001);
    assert.equal(result.receipt.io.stdout.retainedBytes, AGENT_RUN_LIMITS.outputBytes);
    assert.equal(result.receipt.io.stderr.retainedBytes, AGENT_RUN_LIMITS.outputBytes);
    assert.equal(result.receipt.io.stdout.truncated, true);
    assert.equal(result.receipt.io.stderr.truncated, true);
    assert.equal(
      result.receipt.io.stdout.fullDigest,
      createHash("sha256").update("x".repeat(300_000)).digest("hex"),
    );
    assert.equal(
      result.receipt.io.stderr.fullDigest,
      createHash("sha256").update("y".repeat(300_001)).digest("hex"),
    );
  } finally {
    await rm(store, { recursive: true, force: true });
  }
});

test("two researchers launch concurrently without sharing run IDs or corrupting stable session identity", async () => {
  const store = await temporaryStore();
  try {
    const input = {
      agent: "parallel-researcher",
      goal: "Capture an independent concurrent trial",
      out: store,
      cwd: repositoryRoot,
      program: process.execPath,
      args: ["-e", "process.stdout.write('parallel')"],
    };
    const [left, right] = await Promise.all([runAgent(input), runAgent(input)]);
    assert.notEqual(left.receipt.runId, right.receipt.runId);
    assert.equal(left.receipt.workspaceId, right.receipt.workspaceId);
    assert.equal(left.receipt.sessionId, right.receipt.sessionId);
    assert.equal((await completedRunDirectories(store)).length, 2);
    for (const result of [left, right]) {
      assert.equal(
        JSON.parse(await readFile(result.receiptPath, "utf8")).runId,
        result.receipt.runId,
      );
    }
  } finally {
    await rm(store, { recursive: true, force: true });
  }
});

test("sustained sequential use deterministically retains only the newest bounded run set", async () => {
  const store = await temporaryStore();
  try {
    for (let index = 0; index < AGENT_RUN_LIMITS.retention + 2; index += 1) {
      const runId = `seed-${String(index).padStart(2, "0")}`;
      const runDirectory = path.join(store, runId);
      await mkdir(runDirectory);
      await writeFile(
        path.join(runDirectory, "receipt.json"),
        JSON.stringify({
          runId,
          startedAt: new Date(Date.UTC(2020, 0, 1, 0, 0, index)).toISOString(),
        }),
      );
    }
    const newest = await runAgent({
      agent: "sustained-researcher",
      goal: "Apply retention after 52 sequential artifact writes",
      out: store,
      cwd: repositoryRoot,
      program: process.execPath,
      args: ["-e", ""],
    });
    const retained = (await readdir(store, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name !== "sessions")
      .map((entry) => entry.name);
    assert.equal(retained.length, AGENT_RUN_LIMITS.retention);
    assert.equal(retained.includes("seed-00"), false);
    assert.equal(retained.includes("seed-01"), false);
    assert.equal(retained.includes("seed-51"), true);
    assert.equal(retained.includes(newest.receipt.runId), true);
  } finally {
    await rm(store, { recursive: true, force: true });
  }
});

test("untrusted HTML and shell metacharacters stay escaped in the report and literal in argv", async () => {
  const store = await temporaryStore();
  const marker = path.join(store, "must-not-exist.txt");
  const literal = `<script>alert('x')</script>&|;$HOME;${process.execPath} -e "require('fs').writeFileSync('${marker}','owned')"`;
  try {
    const result = await runAgent({
      agent: "<img src=x onerror=alert(1)>",
      goal: "Prove metacharacters remain literal",
      out: store,
      cwd: repositoryRoot,
      program: process.execPath,
      args: ["-e", "process.stdout.write(process.argv[1])", literal],
    });
    assert.equal(result.receipt.command.shell, false);
    assert.equal(result.receipt.command.args.at(-1), literal);
    assert.equal(result.receipt.io.stdout.text, literal);
    const report = await readFile(result.reportPath, "utf8");
    assert.doesNotMatch(report, /<script>alert/u);
    assert.doesNotMatch(report, /<img src=x/u);
    assert.match(report, /&lt;script&gt;alert/u);
    assert.match(report, /&amp;\|;\$HOME/u);
    await assert.rejects(stat(marker), { code: "ENOENT" });
  } finally {
    await rm(store, { recursive: true, force: true });
  }
});

test("operator rejects missing commands, broad output roots, absurd timeouts, and huge goals", async () => {
  const missing = await runCli([
    "agent",
    "run",
    "--agent",
    "operator",
    "--goal",
    "Validate input",
    "--",
  ]);
  assert.notEqual(missing.code, 0);
  assert.match(missing.stderr, /program is required/u);

  await assert.rejects(
    runAgent({
      agent: "operator",
      goal: "Validate output",
      out: path.parse(repositoryRoot).root,
      cwd: repositoryRoot,
      program: process.execPath,
    }),
    /dedicated directory/u,
  );
  await assert.rejects(
    runAgent({
      agent: "operator",
      goal: "Validate timeout",
      cwd: repositoryRoot,
      program: process.execPath,
      timeoutMs: AGENT_RUN_LIMITS.timeoutMaxMs + 1,
    }),
    /timeoutMs must be/u,
  );
  await assert.rejects(
    runAgent({
      agent: "operator",
      goal: "x".repeat(AGENT_RUN_LIMITS.goalChars + 1),
      cwd: repositoryRoot,
      program: process.execPath,
    }),
    /goal exceeds/u,
  );
  const base = {
    agent: "operator",
    goal: "Validate metadata bounds",
    cwd: repositoryRoot,
    program: process.execPath,
  };
  await assert.rejects(
    runAgent({ ...base, agent: "a".repeat(AGENT_RUN_LIMITS.agentChars + 1) }),
    /agent exceeds 128 characters/u,
  );
  await assert.rejects(
    runAgent({ ...base, program: "p".repeat(AGENT_RUN_LIMITS.programChars + 1) }),
    /program exceeds 1024 characters/u,
  );
  await assert.rejects(
    runAgent({ ...base, args: ["x".repeat(AGENT_RUN_LIMITS.argChars + 1)] }),
    /args\[0\] exceeds 8192 characters/u,
  );
  await assert.rejects(
    runAgent({
      ...base,
      args: Array.from({ length: 9 }, () => "x".repeat(AGENT_RUN_LIMITS.argChars)),
    }),
    /args exceed 65536 UTF-8 bytes in total/u,
  );
});

test("a spawn failure lands in the receipt as one bounded line, never a raw error dump", async () => {
  const store = await temporaryStore();
  try {
    // Long enough that the raw message would blow past the cap: the ENOENT message embeds the
    // whole program path, and the receipt is agent-visible.
    const missingProgram = path.join(repositoryRoot, `${"definitely-not-installed-".repeat(30)}agent`);
    const { receipt } = await runAgent({
      agent: "operator",
      goal: "Drive an agent CLI that does not exist on this machine",
      cwd: repositoryRoot,
      out: store,
      program: missingProgram,
    });
    assert.equal(receipt.status, "failed");
    assert.equal(typeof receipt.process.error, "string");
    assert.match(receipt.process.error, /^ENOENT: /u);
    assert.ok(!receipt.process.error.includes("\n"), "the receipt error must be a single line");
    assert.ok(!/ {2,}at /u.test(receipt.process.error), "no stack frames in an agent-visible field");
    assert.ok(
      receipt.process.error.length <= "ENOENT: ".length + 200,
      `error must stay bounded, got ${receipt.process.error.length} characters`,
    );
  } finally {
    await rm(store, { recursive: true, force: true });
  }
});
