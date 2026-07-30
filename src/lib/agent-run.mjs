import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  opendir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const AGENT_RUN_LIMITS = Object.freeze({
  args: 256,
  argChars: 8_192,
  argsBytes: 65_536,
  agentChars: 128,
  events: 128,
  goalChars: 4_096,
  graphEdges: 3,
  graphNodes: 4,
  outputBytes: 256 * 1024,
  pathBytes: 16_384,
  programChars: 1_024,
  retention: 50,
  timeoutMaxMs: 600_000,
  timeoutMinMs: 100,
});

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

export function contentDigest(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function requireText(value, field, maximumCharacters) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} is required`);
  }
  if (value.includes("\0")) throw new TypeError(`${field} cannot contain a null byte`);
  if (maximumCharacters !== undefined && [...value].length > maximumCharacters) {
    throw new RangeError(`${field} exceeds ${maximumCharacters} characters`);
  }
  return value;
}

function requireArgument(value, index) {
  if (typeof value !== "string") throw new TypeError("args must be an array of strings");
  if (value.includes("\0")) throw new TypeError(`args[${index}] cannot contain a null byte`);
  if ([...value].length > AGENT_RUN_LIMITS.argChars) {
    throw new RangeError(`args[${index}] exceeds ${AGENT_RUN_LIMITS.argChars} characters`);
  }
  return value;
}

function normalizeTimeout(value) {
  const timeoutMs = value === undefined ? 120_000 : Number(value);
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < AGENT_RUN_LIMITS.timeoutMinMs ||
    timeoutMs > AGENT_RUN_LIMITS.timeoutMaxMs
  ) {
    throw new RangeError(
      `timeoutMs must be an integer from ${AGENT_RUN_LIMITS.timeoutMinMs} to ${AGENT_RUN_LIMITS.timeoutMaxMs}`,
    );
  }
  return timeoutMs;
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

async function nearestExistingAncestor(target) {
  let current = target;
  while (true) {
    try {
      await stat(current);
      return current;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

async function resolveOutputRoot(repoRoot, requestedOut) {
  const rawOut = requestedOut === undefined ? ".nodekit/agent-runs" : requireText(requestedOut, "out");
  if (Buffer.byteLength(rawOut, "utf8") > AGENT_RUN_LIMITS.pathBytes) {
    throw new RangeError(`out exceeds ${AGENT_RUN_LIMITS.pathBytes} UTF-8 bytes`);
  }
  const outputRoot = path.resolve(repoRoot, rawOut);
  const root = path.parse(outputRoot).root;
  const userHome = path.resolve(homedir());
  if (
    outputRoot === root
    || outputRoot === userHome
    || outputRoot === repoRoot
    || isContained(outputRoot, repoRoot)
  ) {
    throw new RangeError(
      "out must be a dedicated directory, not a filesystem root, home, repository, or repository ancestor",
    );
  }
  const ancestor = await nearestExistingAncestor(outputRoot);
  if (ancestor === outputRoot && (await lstat(ancestor)).isSymbolicLink()) {
    throw new RangeError("out cannot be a symbolic link");
  }
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const outputInfo = await lstat(outputRoot);
  if (!outputInfo.isDirectory() || outputInfo.isSymbolicLink()) {
    throw new RangeError("out must resolve to a real directory");
  }
  const resolvedOutput = await realpath(outputRoot);
  if (
    resolvedOutput === path.parse(resolvedOutput).root
    || resolvedOutput === userHome
    || resolvedOutput === repoRoot
    || isContained(resolvedOutput, repoRoot)
  ) {
    throw new RangeError("out resolves to a broad directory");
  }
  return resolvedOutput;
}

function createBoundedCapture() {
  const bytes = Buffer.allocUnsafe(AGENT_RUN_LIMITS.outputBytes);
  const fullHash = createHash("sha256");
  let capturedBytes = 0;
  let observedBytes = 0;
  return {
    append(chunk) {
      const source = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      fullHash.update(source);
      observedBytes = Math.min(Number.MAX_SAFE_INTEGER, observedBytes + source.length);
      const available = AGENT_RUN_LIMITS.outputBytes - capturedBytes;
      if (available > 0) {
        const copied = source.copy(bytes, capturedBytes, 0, Math.min(available, source.length));
        capturedBytes += copied;
      }
    },
    value() {
      const retained = bytes.subarray(0, capturedBytes);
      return {
        observedBytes,
        retainedBytes: capturedBytes,
        text: retained.toString("utf8"),
        truncated: observedBytes > capturedBytes,
        retainedDigest: createHash("sha256").update(retained).digest("hex"),
        fullDigest: fullHash.digest("hex"),
      };
    },
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function commandText(program, args) {
  return [program, ...args]
    .map((part) => (/^[A-Za-z0-9_./:@+-]+$/.test(part) ? part : JSON.stringify(part)))
    .join(" ");
}

function createRunGraph({ goal, program, args, startedAt, result, io, outcome }) {
  const nodes = [
    {
      detail: goal,
      endedAt: startedAt,
      evidenceRefs: ["receipt.json#/goal", "receipt.json#/digests/goal"],
      id: "goal",
      kind: "goal",
      label: "Goal",
      startedAt,
      status: "completed",
    },
    {
      detail: `${program} (${args.length} argument${args.length === 1 ? "" : "s"})`,
      endedAt: result.endedAt,
      evidenceRefs: ["receipt.json#/command", "receipt.json#/process"],
      id: "process",
      kind: "process",
      label: "Agent process",
      startedAt,
      status: result.status,
    },
    {
      detail: `${io.stdout.observedBytes} stdout bytes; ${io.stderr.observedBytes} stderr bytes`,
      endedAt: result.endedAt,
      evidenceRefs: [
        "receipt.json#/io/stdout",
        "receipt.json#/io/stderr",
        "report.html#exact-title",
      ],
      id: "evidence",
      kind: "evidence",
      label: "Captured evidence",
      startedAt: result.endedAt,
      status: "completed",
    },
    {
      detail: outcome.summary,
      endedAt: result.endedAt,
      evidenceRefs: ["receipt.json#/status", "receipt.json#/outcome", "report.html#report-title"],
      id: "outcome",
      kind: "outcome",
      label: "Outcome",
      startedAt: result.endedAt,
      status: result.status,
    },
  ].slice(0, AGENT_RUN_LIMITS.graphNodes);
  const edges = [
    { from: "goal", id: "goal-process", relation: "requested", to: "process" },
    { from: "process", id: "process-evidence", relation: "observed", to: "evidence" },
    { from: "evidence", id: "evidence-outcome", relation: "supports", to: "outcome" },
  ].slice(0, AGENT_RUN_LIMITS.graphEdges);
  const graphBody = {
    schemaVersion: "nodekit.agent-run-graph/v1",
    limits: {
      edges: AGENT_RUN_LIMITS.graphEdges,
      evidenceRefsPerNode: 3,
      nodes: AGENT_RUN_LIMITS.graphNodes,
    },
    nodes,
    edges,
  };
  return {
    ...graphBody,
    graphDigest: contentDigest(graphBody),
  };
}

function renderReport(receipt) {
  const timeline = receipt.events
    .map(
      (event) =>
        `<li><time datetime="${escapeHtml(event.at)}">${escapeHtml(event.at)}</time><span>${escapeHtml(event.message)}</span></li>`,
    )
    .join("");
  const statusLabel =
    receipt.status === "completed"
      ? "Completed"
      : receipt.status === "timeout"
        ? "Timed out"
        : "Failed";
  const exactCommand = commandText(receipt.command.program, receipt.command.args);
  const graphNodes = receipt.graph.nodes
    .map((node, index) => {
      const next = receipt.graph.nodes[index + 1];
      const edge = next
        ? receipt.graph.edges.find((candidate) => candidate.from === node.id && candidate.to === next.id)
        : undefined;
      const renderedNode = `<div class="node" data-testid="execution-node-${escapeHtml(node.id)}" data-node-status="${escapeHtml(node.status)}"><b>${escapeHtml(node.label)}</b><br>${escapeHtml(node.detail)}<br><span class="meta">${escapeHtml(node.status)}</span></div>`;
      return edge
        ? `${renderedNode}<span class="arrow" aria-label="${escapeHtml(edge.relation)}">-&gt;</span>`
        : renderedNode;
    })
    .join("");
  const graphLabel = receipt.graph.nodes
    .map((node) => `${node.label}: ${node.status}`)
    .join("; ");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(receipt.agent.label)} - Agent run report</title>
<style>
:root{color-scheme:light dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;line-height:1.5;--bg:#f6f7fb;--card:#fff;--ink:#172033;--muted:#5c667a;--line:#d9deea;--accent:#3157d5}
@media(prefers-color-scheme:dark){:root{--bg:#10131b;--card:#181d29;--ink:#edf0f7;--muted:#a9b1c2;--line:#343c4e;--accent:#8ea8ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink)}main{width:min(960px,calc(100% - 2rem));margin:2rem auto 4rem}.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:clamp(1rem,3vw,2rem);margin-block:1rem;box-shadow:0 8px 30px #0000000d}h1,h2{line-height:1.15}h1{margin:.35rem 0;font-size:clamp(1.7rem,5vw,3rem)}h2{font-size:1.15rem}.eyebrow,.meta{color:var(--muted)}.status{display:inline-block;border:1px solid currentColor;border-radius:999px;padding:.25rem .65rem;font-weight:700}.summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:.75rem}.datum{border-left:3px solid var(--accent);padding-left:.75rem}.datum b{display:block}.flow{display:grid;grid-template-columns:repeat(7,auto);align-items:center;gap:.5rem;overflow-x:auto;padding:.5rem}.node{min-width:130px;text-align:center;border:1px solid var(--line);border-radius:12px;padding:.75rem;background:var(--bg)}.arrow{color:var(--accent);font-size:1.3rem}ol{padding-left:1.25rem}li{margin:.7rem 0}time{display:block;color:var(--muted);font-size:.85rem}details{border-top:1px solid var(--line);padding-top:1rem}summary{cursor:pointer;font-weight:700}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--bg);padding:1rem;border-radius:10px;max-height:26rem;overflow:auto}.io-meta{color:var(--muted);font-size:.9rem}
@media(max-width:680px){main{width:min(100% - 1rem,960px);margin-top:.5rem}.flow{grid-template-columns:1fr}.arrow{transform:rotate(90deg);text-align:center}}
</style>
</head>
<body>
<main data-testid="agent-run-report">
<section class="card" aria-labelledby="report-title">
  <p class="eyebrow">NodeKit Agent Flight Recorder</p>
  <h1 id="report-title">${escapeHtml(receipt.agent.label)}</h1>
  <p>${escapeHtml(receipt.goal)}</p>
  <p><span class="status" data-testid="run-status">${escapeHtml(statusLabel)}</span></p>
  <div class="summary-grid">
    <p class="datum"><b>Outcome</b>${escapeHtml(receipt.outcome.summary)}</p>
    <p class="datum"><b>Duration</b>${escapeHtml(receipt.durationMs)} ms</p>
    <p class="datum"><b>Exit code</b>${escapeHtml(receipt.process.exitCode ?? "none")}</p>
    <p class="datum"><b>Run ID</b><span class="meta">${escapeHtml(receipt.runId)}</span></p>
  </div>
</section>
<section class="card" aria-labelledby="graph-title">
  <h2 id="graph-title">Execution graph</h2>
  <div class="flow" data-testid="execution-graph" role="img" aria-label="${escapeHtml(graphLabel)}">${graphNodes}</div>
</section>
<section class="card" aria-labelledby="timeline-title">
  <h2 id="timeline-title">What happened</h2>
  <ol>${timeline}</ol>
</section>
<section class="card" data-testid="exact-io" aria-labelledby="exact-title">
  <h2 id="exact-title">Exact I/O</h2>
  <details>
    <summary>Command</summary>
    <pre>${escapeHtml(exactCommand)}</pre>
  </details>
  <details>
    <summary>stdout</summary>
    <p class="io-meta">${escapeHtml(receipt.io.stdout.observedBytes)} bytes observed${receipt.io.stdout.truncated ? "; capture truncated" : ""}</p>
    <pre>${escapeHtml(receipt.io.stdout.text)}</pre>
  </details>
  <details>
    <summary>stderr</summary>
    <p class="io-meta">${escapeHtml(receipt.io.stderr.observedBytes)} bytes observed${receipt.io.stderr.truncated ? "; capture truncated" : ""}</p>
    <pre>${escapeHtml(receipt.io.stderr.text)}</pre>
  </details>
  <details>
    <summary>Capture limitations</summary>
    <ul>${receipt.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
  </details>
</section>
</main>
</body>
</html>`;
}

async function atomicWrite(file, content) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
  await rename(temporary, file);
}

async function persistIdentity(outputRoot, identity) {
  const sessionsDirectory = path.join(outputRoot, "sessions");
  await mkdir(sessionsDirectory, { recursive: true, mode: 0o700 });
  const records = [
    [
      path.join(outputRoot, "workspace.json"),
      {
        schemaVersion: "nodekit.agent-run-workspace/v1",
        workspaceId: identity.workspaceId,
      },
    ],
    [
      path.join(
        sessionsDirectory,
        `${identity.sessionId.replace("session_", "")}.json`,
      ),
      {
        schemaVersion: "nodekit.agent-run-session/v1",
        workspaceId: identity.workspaceId,
        sessionId: identity.sessionId,
        agentLabel: identity.agent,
      },
    ],
  ];
  for (const [file, expected] of records) {
    try {
      await writeFile(file, `${stableStringify(expected)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let current;
      try {
        current = JSON.parse(await readFile(file, "utf8"));
      } catch {
        throw new Error(`persisted identity is unreadable: ${path.basename(file)}`);
      }
      if (contentDigest(current) !== contentDigest(expected)) {
        throw new Error(`persisted identity conflicts with ${path.basename(file)}`);
      }
    }
  }
}

function addEvent(events, event) {
  if (events.length < AGENT_RUN_LIMITS.events) events.push(event);
}

async function execute(program, args, repoRoot, timeoutMs, events) {
  const stdout = createBoundedCapture();
  const stderr = createBoundedCapture();
  let spawnError;
  let timedOut = false;
  const startedAtMs = Date.now();
  addEvent(events, {
    at: new Date(startedAtMs).toISOString(),
    message: `Started ${program} with ${args.length} argument${args.length === 1 ? "" : "s"}.`,
    type: "process-started",
  });

  const controller = new AbortController();
  const child = spawn(program, args, {
    cwd: repoRoot,
    shell: false,
    signal: controller.signal,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => stdout.append(chunk));
  child.stderr.on("data", (chunk) => stderr.append(chunk));
  child.on("error", (error) => {
    spawnError = error;
  });

  let forceTimer;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    forceTimer = setTimeout(() => child.kill("SIGKILL"), 1_000);
    forceTimer.unref();
  }, timeoutMs);
  timeoutTimer.unref();

  const { code, signal } = await new Promise((resolve) => {
    child.once("close", (exitCode, exitSignal) => resolve({ code: exitCode, signal: exitSignal }));
  });
  clearTimeout(timeoutTimer);
  clearTimeout(forceTimer);
  const endedAtMs = Date.now();
  const status = timedOut ? "timeout" : !spawnError && code === 0 ? "completed" : "failed";
  addEvent(events, {
    at: new Date(endedAtMs).toISOString(),
    message:
      status === "completed"
        ? "The process completed successfully."
        : status === "timeout"
          ? `The process exceeded the ${timeoutMs} ms budget and was terminated.`
          : `The process failed${code === null ? "" : ` with exit code ${code}`}.`,
    type: status === "completed" ? "process-completed" : status === "timeout" ? "process-timeout" : "process-failed",
  });
  return {
    durationMs: endedAtMs - startedAtMs,
    endedAt: new Date(endedAtMs).toISOString(),
    error: spawnError?.message ?? null,
    exitCode: code,
    signal,
    status,
    stderr: stderr.value(),
    stdout: stdout.value(),
  };
}

async function readReceiptKey(directory) {
  const receiptPath = path.join(directory, "receipt.json");
  try {
    const metadata = await stat(receiptPath);
    const maximumReceiptBytes = AGENT_RUN_LIMITS.outputBytes * 12 + 262_144;
    if (!metadata.isFile() || metadata.size > maximumReceiptBytes) return null;
    const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    if (typeof receipt.startedAt !== "string" || typeof receipt.runId !== "string") return null;
    return `${receipt.startedAt}\u0000${receipt.runId}`;
  } catch {
    return null;
  }
}

async function enforceRetention(outputRoot) {
  const newest = [];
  const staleTemporaryAgeMs = AGENT_RUN_LIMITS.timeoutMaxMs + 60_000;
  const directory = await opendir(outputRoot);
  for await (const entry of directory) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".tmp-")) {
      const temporary = path.join(outputRoot, entry.name);
      try {
        const metadata = await stat(temporary);
        if (Date.now() - metadata.mtimeMs > staleTemporaryAgeMs) {
          await rm(temporary, { force: true, recursive: true });
        }
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      continue;
    }
    const runDirectory = path.join(outputRoot, entry.name);
    const key = await readReceiptKey(runDirectory);
    if (!key) continue;
    newest.push({ key, name: entry.name });
    newest.sort((left, right) => right.key.localeCompare(left.key));
    if (newest.length <= AGENT_RUN_LIMITS.retention) continue;
    const stale = newest.pop();
    await rm(path.join(outputRoot, stale.name), {
      force: true,
      recursive: true,
    });
  }
}

export async function runAgent(options = {}) {
  const agent = requireText(
    options.agent,
    "agent",
    AGENT_RUN_LIMITS.agentChars,
  );
  const goal = requireText(options.goal, "goal", AGENT_RUN_LIMITS.goalChars);
  const program = requireText(
    options.program,
    "program",
    AGENT_RUN_LIMITS.programChars,
  );
  const rawArgs = options.args === undefined ? [] : options.args;
  if (!Array.isArray(rawArgs)) {
    throw new TypeError("args must be an array of strings");
  }
  if (rawArgs.length > AGENT_RUN_LIMITS.args) {
    throw new RangeError(`args cannot contain more than ${AGENT_RUN_LIMITS.args} entries`);
  }
  const args = rawArgs.map(requireArgument);
  const totalArgBytes = args.reduce(
    (total, value) => total + Buffer.byteLength(value, "utf8"),
    0,
  );
  if (totalArgBytes > AGENT_RUN_LIMITS.argsBytes) {
    throw new RangeError(`args exceed ${AGENT_RUN_LIMITS.argsBytes} UTF-8 bytes in total`);
  }
  const timeoutMs = normalizeTimeout(options.timeoutMs);
  const repoRoot = await realpath(path.resolve(options.cwd ?? process.cwd()));
  const outputRoot = await resolveOutputRoot(repoRoot, options.out);
  const workspaceId = `ws_${contentDigest({ cwd: repoRoot })}`;
  const sessionId = `session_${contentDigest({ agent, workspaceId })}`;
  const runId = randomUUID();
  await persistIdentity(outputRoot, { agent, sessionId, workspaceId });
  const temporaryRunDirectory = path.join(outputRoot, `.tmp-${runId}`);
  const runDirectory = path.join(outputRoot, runId);
  await mkdir(temporaryRunDirectory, { mode: 0o700 });

  const events = [];
  const startedAt = new Date().toISOString();
  const result = await execute(program, args, repoRoot, timeoutMs, events);
  const io = { stderr: result.stderr, stdout: result.stdout };
  const outcome = {
    summary:
      result.status === "completed"
        ? "The requested command completed."
        : result.status === "timeout"
          ? "The requested command timed out."
          : "The requested command did not complete successfully.",
  };
  const graph = createRunGraph({
    args,
    goal,
    io,
    outcome,
    program,
    result,
    startedAt,
  });
  const receiptBody = {
    schemaVersion: "nodekit.agent-run/v1",
    agent: { label: agent },
    command: { args: [...args], program, shell: false },
    digests: {
      command: contentDigest({ args, program, shell: false }),
      events: contentDigest(events),
      goal: contentDigest({ goal }),
      stderr: result.stderr.fullDigest,
      stdout: result.stdout.fullDigest,
    },
    durationMs: result.durationMs,
    endedAt: result.endedAt,
    events,
    goal,
    graph,
    io,
    limits: {
      agentCharacters: AGENT_RUN_LIMITS.agentChars,
      argCharacters: AGENT_RUN_LIMITS.argChars,
      args: AGENT_RUN_LIMITS.args,
      argsBytes: AGENT_RUN_LIMITS.argsBytes,
      events: AGENT_RUN_LIMITS.events,
      goalCharacters: AGENT_RUN_LIMITS.goalChars,
      graphEdges: AGENT_RUN_LIMITS.graphEdges,
      graphNodes: AGENT_RUN_LIMITS.graphNodes,
      outputBytesPerStream: AGENT_RUN_LIMITS.outputBytes,
      programCharacters: AGENT_RUN_LIMITS.programChars,
      retention: AGENT_RUN_LIMITS.retention,
      timeoutMs,
    },
    outcome,
    process: {
      error: result.error,
      exitCode: result.exitCode,
      signal: result.signal,
    },
    runId,
    sessionId,
    startedAt,
    status: result.status,
    workspaceId,
    limitations: [
      "Captures the spawned process boundary only; child-created files, tool calls, and network activity are not independently observed.",
      `Retains at most ${AGENT_RUN_LIMITS.outputBytes} bytes from each output stream and ${AGENT_RUN_LIMITS.events} lifecycle events.`,
      `Retains the newest ${AGENT_RUN_LIMITS.retention} completed run directories and deterministically evicts older runs.`,
      "Environment variables, stdin, and inherited credentials are not copied into the receipt.",
      "Termination is best-effort for descendant processes that detach from the spawned process.",
    ],
  };
  const receipt = {
    ...receiptBody,
    receiptDigest: contentDigest(receiptBody),
  };
  const temporaryReceiptPath = path.join(temporaryRunDirectory, "receipt.json");
  const temporaryReportPath = path.join(temporaryRunDirectory, "report.html");
  try {
    await atomicWrite(temporaryReportPath, renderReport(receipt));
    await atomicWrite(temporaryReceiptPath, `${stableStringify(receipt)}\n`);
    await rename(temporaryRunDirectory, runDirectory);
  } catch (error) {
    await rm(temporaryRunDirectory, { recursive: true, force: true });
    throw error;
  }
  await enforceRetention(outputRoot);
  return {
    receipt,
    receiptPath: path.join(runDirectory, "receipt.json"),
    reportPath: path.join(runDirectory, "report.html"),
  };
}
