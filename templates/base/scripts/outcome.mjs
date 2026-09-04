import { createHash } from "node:crypto";
import { mkdir, open, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Application bookkeeping uses the existing NodeAgent event envelope. This is
// neither a Caseflow authority nor a NodeProof/Evolution approval mechanism.
export const LIMITS = Object.freeze({ inputBytes: 32768, artifactBytes: 1048576, logBytes: 4194304, events: 256, reportBytes: 4194304 });
const schema = JSON.parse(await readFile(new URL("../schemas/outcome-contract.schema.json", import.meta.url), "utf8"));
const zeroHash = "0".repeat(64);
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const fail = (message) => { throw new Error(message); };
const location = (root, name) => path.join(path.resolve(root), "proof", "outcome", name);

// Only the JSON Schema keywords used by the bundled application schema are
// needed here; the schema remains the single input contract, with no dependency.
function validate(value, rule, label = "input") {
  if (rule.$ref) return validate(value, schema.$defs[rule.$ref.split("/").at(-1)], label);
  if ("const" in rule && value !== rule.const) fail(`${label}: expected ${rule.const}`);
  if (rule.enum && !rule.enum.includes(value)) fail(`${label}: invalid choice`);
  if (rule.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label}: expected object`);
    for (const key of rule.required ?? []) if (!Object.hasOwn(value, key)) fail(`${label}.${key}: required`);
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(rule.properties, key)) fail(`${label}.${key}: unknown field`);
      validate(value[key], rule.properties[key], `${label}.${key}`);
    }
  } else if (rule.type === "array") {
    if (!Array.isArray(value) || value.length < (rule.minItems ?? 0) || value.length > rule.maxItems) fail(`${label}: invalid array size`);
    if (rule.uniqueItems && new Set(value.map(canonical)).size !== value.length) fail(`${label}: duplicate values`);
    value.forEach((item, index) => validate(item, rule.items, `${label}[${index}]`));
  } else if (rule.type === "string") {
    if (typeof value !== "string" || !value.trim() || value.length < rule.minLength || value.length > rule.maxLength || (rule.pattern && !new RegExp(rule.pattern).test(value))) fail(`${label}: invalid text`);
  } else if (["number", "integer"].includes(rule.type)) {
    if (typeof value !== "number" || !Number.isFinite(value) || (rule.type === "integer" && !Number.isInteger(value)) || value < (rule.minimum ?? -Infinity) || value > (rule.maximum ?? Infinity)) fail(`${label}: invalid number`);
  } else if (rule.type === "boolean" && typeof value !== "boolean") fail(`${label}: expected boolean`);
}

function validateContract(contract) {
  validate(contract, schema, "contract");
  if (new Set(contract.cases.map((item) => item.id)).size !== contract.cases.length) fail("contract: duplicate case IDs");
  if (!contract.cases.some((item) => item.required)) fail("contract: at least one required case is needed");
}

function validateRecord(record) {
  const definition = { case: "caseRecord", decision: "decisionRecord", complete: "completeRecord" }[record?.type];
  if (!definition) fail("record: expected case, decision, or complete");
  validate(record, schema.$defs[definition], "record");
}

async function boundedRead(file, limit) {
  const handle = await open(file, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) fail(`file must be regular and at most ${limit} bytes`);
    const buffer = Buffer.alloc(limit + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, null);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset > limit) fail(`file exceeds ${limit} bytes`);
    return buffer.subarray(0, offset);
  } finally { await handle.close(); }
}

function boundedInput(value) {
  const serialized = JSON.stringify(value);
  if (!serialized || Buffer.byteLength(serialized) > LIMITS.inputBytes) fail("input exceeds byte limit");
  return JSON.parse(serialized);
}

async function observe(root, ref) {
  const project = await realpath(root);
  const absolute = await realpath(path.resolve(project, ref));
  const relative = path.relative(project, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail("evidence must stay inside the project");
  if (/(^|[\\/])(?:\.env(?:\..*)?|[^\\/]*\.(?:pem|key))$/i.test(relative)) fail("credential files cannot be evidence");
  if (absolute === location(project, "events.jsonl")) fail("the outcome log cannot be its own evidence");
  const bytes = await boundedRead(absolute, LIMITS.artifactBytes);
  if (!bytes.length) fail("observed evidence is empty");
  return { ref: relative.split(path.sep).join("/"), sha256: digest(bytes), bytes: bytes.length };
}

function eventHash(event) {
  const { contentHash, ...payload } = event.payload;
  return digest(canonical({ ...event, payload }));
}

function makeEvent(contract, events, record, observation) {
  const sequence = events.length;
  const event = {
    schemaVersion: "nodeagent.event/v1", eventId: `${contract.runId}:${sequence}`, runId: contract.runId,
    sequence, type: `outcome.${record.type}`, occurredAt: new Date().toISOString(), actor: { type: "agent" },
    payload: { previousHash: events.at(-1)?.payload.contentHash ?? zeroHash, record, ...(observation ? { observation } : {}) },
  };
  event.payload.contentHash = eventHash(event);
  return event;
}

function latestCases(events) {
  return new Map(events.filter((event) => event.type === "outcome.case").map((event) => [event.payload.record.caseId, event]));
}

function assertCanAppend(contract, events, record) {
  if (events.at(-1)?.type === "outcome.complete") fail("outcome already complete; start a new run in a separate project proof directory");
  if (events.length >= LIMITS.events - (record.type === "complete" ? 0 : 1)) fail("event limit reached; final slot is reserved for completion");
  if (record.type === "case") {
    if (!contract.cases.some((item) => item.id === record.caseId)) fail(`unknown case: ${record.caseId}`);
    if (events.filter((event) => event.type === "outcome.case" && event.payload.record.caseId === record.caseId).length >= contract.budgets.attemptsPerCase) fail(`attempt budget exceeded: ${record.caseId}`);
  }
  if (record.type === "complete") {
    const latest = latestCases(events);
    const missing = contract.cases.filter((item) => item.required && (latest.get(item.id)?.payload.record.status !== "passed" || !latest.get(item.id)?.payload.observation));
    if (missing.length) fail(`completion blocked; required cases need passing observed evidence: ${missing.map((item) => item.id).join(", ")}`);
  }
}

export async function readOutcome(root = process.cwd()) {
  const bytes = await boundedRead(location(root, "events.jsonl"), LIMITS.logBytes);
  if (!bytes.length || bytes.at(-1) !== 10) fail("incomplete outcome log; preserve it and recover from a trusted backup");
  const lines = bytes.toString("utf8").slice(0, -1).split("\n");
  if (lines.length > LIMITS.events) fail("event limit exceeded");
  const events = [];
  let contract;
  for (const line of lines) {
    if (Buffer.byteLength(line) > LIMITS.inputBytes + 4096) fail("event exceeds byte limit");
    const event = JSON.parse(line);
    const { payload } = event;
    if (!payload || event.schemaVersion !== "nodeagent.event/v1" || event.sequence !== events.length || payload.previousHash !== (events.at(-1)?.payload.contentHash ?? zeroHash) || payload.contentHash !== eventHash(event)) fail("outcome hash chain or sequence is invalid");
    if (Object.keys(event).sort().join() !== "actor,eventId,occurredAt,payload,runId,schemaVersion,sequence,type" || event.actor?.type !== "agent" || Object.keys(event.actor).length !== 1 || !/^\d{4}-\d{2}-\d{2}T/.test(event.occurredAt) || new Date(event.occurredAt).toISOString() !== event.occurredAt) fail("invalid event envelope");
    if (!events.length) {
      if (event.type !== "outcome.initialized" || payload.record?.type !== "initialized") fail("initialization must be first");
      contract = payload.record.contract;
      validateContract(contract);
    } else {
      validateRecord(payload.record);
      if (event.type !== `outcome.${payload.record.type}`) fail("event type mismatch");
      assertCanAppend(contract, events, payload.record);
    }
    if (event.runId !== contract.runId || event.eventId !== `${contract.runId}:${events.length}`) fail("event run identity mismatch");
    const observed = payload.record.type === "case" && payload.record.evidence.kind === "observed";
    if (Object.keys(payload).sort().join() !== (observed ? "contentHash,observation,previousHash,record" : "contentHash,previousHash,record")) fail("invalid event payload");
    if (observed && (!payload.observation || Object.keys(payload.observation).sort().join() !== "bytes,ref,sha256" || typeof payload.observation.ref !== "string" || payload.observation.ref.length > 2000 || !/^[a-f0-9]{64}$/.test(payload.observation.sha256) || !Number.isInteger(payload.observation.bytes) || payload.observation.bytes < 1 || payload.observation.bytes > LIMITS.artifactBytes)) fail("invalid observed evidence binding");
    events.push(event);
  }
  return { contract, events, logHash: events.at(-1).payload.contentHash };
}

async function locked(root, callback) {
  const directory = location(root, "");
  await mkdir(directory, { recursive: true });
  const lockPath = location(root, ".write-lock");
  let lock;
  try { lock = await open(lockPath, "wx"); }
  catch (error) { if (error.code === "EEXIST") fail("outcome writer busy; a crashed writer's lock requires operator inspection"); throw error; }
  try { return await callback(); }
  finally { await lock.close(); await unlink(lockPath); }
}

async function persist(root, event, create = false) {
  const line = `${canonical(event)}\n`;
  const handle = await open(location(root, "events.jsonl"), create ? "wx" : "a");
  try {
    if ((await handle.stat()).size + Buffer.byteLength(line) > LIMITS.logBytes) fail("outcome log byte limit reached");
    await handle.writeFile(line, "utf8");
    await handle.sync();
  } finally { await handle.close(); }
  return event;
}

export async function initializeOutcome(root, input) {
  const contract = boundedInput(input);
  validateContract(contract);
  return locked(root, () => persist(root, makeEvent(contract, [], { type: "initialized", contract }), true));
}

export async function appendOutcome(root, input) {
  const record = boundedInput(input);
  validateRecord(record);
  return locked(root, async () => {
    const { contract, events } = await readOutcome(root);
    assertCanAppend(contract, events, record);
    const observation = record.type === "case" && record.evidence.kind === "observed" ? await observe(root, record.evidence.ref) : undefined;
    if (record.type === "complete") {
      for (const item of contract.cases.filter((item) => item.required)) {
        const pinned = latestCases(events).get(item.id).payload.observation;
        const current = await observe(root, pinned.ref);
        if (current.sha256 !== pinned.sha256) fail(`evidence changed since observation: ${item.id}`);
      }
    }
    return persist(root, makeEvent(contract, events, record, observation));
  });
}

const asciiText = (value) => String(value).replace(/[^\x20-\x7e]/gu, (character) => `\\u{${character.codePointAt(0).toString(16)}}`);
const htmlEscape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

export async function renderOutcome(root = process.cwd()) {
  const { contract, events, logHash } = await readOutcome(root);
  const latest = latestCases(events);
  const state = events.at(-1).type === "outcome.complete" ? "COMPLETE (local evidence gate only)" : "OPEN";
  const lines = ["CODING OUTCOME RECORD", `Run: ${contract.runId}`, `State: ${state}`, `Log hash: ${logHash}`,
    "Status assertions and measurements are self-reported. Observed means local artifact bytes were read and hashed.",
    "This is not independent verification, approval, or deployment proof.", "", `User job: ${contract.userJob}`, `Target: ${contract.target}`,
    `Current: ${canonical(contract.currentVersion)}`, `Candidate: ${canonical(contract.candidateVersion)}`, `Scope: ${contract.context.scope}`,
    `Sources: ${contract.context.sourceRefs.join("; ")}`, `Budgets: ${canonical(contract.budgets)}`, "", "REQUIRED AND OPTIONAL CASES"];
  for (const item of contract.cases) {
    const event = latest.get(item.id);
    lines.push(`${item.id} [${item.required ? "required" : "optional"}]: ${event?.payload.record.status ?? "not run"} - ${item.description}`);
  }
  lines.push("", "INVARIANTS", ...contract.invariants, "", "APPEND-ONLY HISTORY");
  for (const event of events) {
    const { record, observation } = event.payload;
    lines.push(`${event.sequence} | ${event.occurredAt} | ${event.type} | ${record.summary ?? contract.target}`);
    if (record.type === "case") {
      lines.push(`  ${record.caseId}: ${record.status} (self-reported); evidence: ${record.evidence.kind}`,
        `  ${observation ? `${observation.ref} | sha256=${observation.sha256} | bytes=${observation.bytes}` : record.evidence.ref}`,
        `  Measurements (self-reported): ${canonical(record.measurements)}`);
    }
    if (record.type === "decision") lines.push(`  Decision: ${record.decision} (recorded intent; no authority granted)`);
  }
  const ascii = `${lines.map(asciiText).join("\n")}\n`;
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Coding outcome ${htmlEscape(contract.runId)}</title><style>body{max-width:72rem;margin:2rem auto;padding:0 1rem;font:16px/1.5 system-ui;color:#18212d;background:#f8fafc}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.6 ui-monospace,monospace}</style><body><pre>${htmlEscape(ascii)}</pre></body></html>\n`;
  if (Buffer.byteLength(ascii) > LIMITS.reportBytes || Buffer.byteLength(html) > LIMITS.reportBytes) fail("report byte limit exceeded");
  return { ascii, html, logHash };
}

async function main(args) {
  const rootIndex = args.indexOf("--root");
  let root = process.cwd();
  if (rootIndex !== -1) {
    if (!args[rootIndex + 1]) fail("--root requires a directory");
    root = path.resolve(args[rootIndex + 1]);
    args.splice(rootIndex, 2);
  }
  const [command, inputFile] = args;
  if (["init", "append"].includes(command) && args.length === 2) {
    const input = JSON.parse((await boundedRead(path.resolve(inputFile), LIMITS.inputBytes)).toString("utf8"));
    const event = await (command === "init" ? initializeOutcome(root, input) : appendOutcome(root, input));
    console.log(`${event.type}: ${event.payload.contentHash}`);
  } else if (command === "report" && args.length === 1) {
    const report = await renderOutcome(root);
    await writeFile(location(root, "report.txt"), report.ascii);
    await writeFile(location(root, "report.html"), report.html);
    console.log(report.ascii);
  } else fail("Usage: node scripts/outcome.mjs init CONTRACT.json | append RECORD.json | report [--root PROJECT]");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(`Outcome error: ${error.message}`); process.exitCode = 1; });
}
