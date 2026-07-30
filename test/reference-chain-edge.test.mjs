import assert from "node:assert/strict";
import test from "node:test";
import {
  buildReferenceChainEdge,
  verifyReferenceChainEdge,
} from "../src/lib/reference-loop.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);
const COMMIT_A = "1".repeat(40);

function recordRef(schemaVersion, idField, recordId, contentDigest) {
  return { schemaVersion, idField, recordId, contentDigest };
}

function edgeDraft(overrides = {}) {
  return {
    schemaVersion: "nodekit.reference-chain-edge/v1",
    from: recordRef(
      "nodekit.external-reference-run/v1",
      "runId",
      "external_run_aaaaaaaaaaaaaaaaaaaaaaaa",
      HASH_A,
    ),
    to: recordRef(
      "nodekit.reference-loop-observation/v1",
      "observationId",
      "observation_bbbbbbbbbbbbbbbbbbbbbbbb",
      HASH_B,
    ),
    caseBinding: {
      caseId: "case-note-surface",
      stageId: "prove",
      caseContentHash: HASH_C,
    },
    repositoryBinding: {
      remote: "https://github.com/HomenShum/NodeRoom.git",
      commitSha: COMMIT_A,
      treeHash: HASH_D,
    },
    authority: {
      kind: "externally-observed",
      attestationRefs: [
        recordRef(
          "nodekit.reference-service-attestation/v1",
          "attestationId",
          "attestation:mobbin:2026-07-30",
          HASH_C,
        ),
        recordRef(
          "nodekit.workspace-attestation/v1",
          "attestationId",
          "attestation:workspace:2026-07-30",
          HASH_D,
        ),
      ],
    },
    createdAt: "2026-07-30T05:00:00.000Z",
    limitations: [
      "The edge binds evidence and does not grant stage or verdict authority.",
    ],
    ...overrides,
  };
}

function verificationContext(edge, overrides = {}) {
  return {
    from: edge.from,
    to: edge.to,
    caseBinding: edge.caseBinding,
    repositoryBinding: edge.repositoryBinding,
    attestationRefs: edge.authority.attestationRefs ?? [],
    receiptRefs: edge.authority.receiptRefs ?? [],
    ...overrides,
  };
}

test("NodeRoom reference consumption binds one immutable evidence handoff without verdict authority", async () => {
  const first = buildReferenceChainEdge(edgeDraft());
  const second = buildReferenceChainEdge({
    ...edgeDraft(),
    authority: {
      ...edgeDraft().authority,
      attestationRefs: [...edgeDraft().authority.attestationRefs].reverse(),
    },
  });

  assert.equal(first.edgeId, `reference_chain_edge_${first.contentDigest.slice(0, 24)}`);
  assert.equal(first.edgeId, second.edgeId);
  assert.equal(first.contentDigest, second.contentDigest);
  assert.deepEqual(
    await verifyReferenceChainEdge(first, verificationContext(first)),
    {
      edge: first,
      contentDigest: first.contentDigest,
      verified: true,
    },
  );
  assert.equal("verdict" in first, false);
  assert.equal("approved" in first, false);
  assert.equal("verified" in first, false);
});

test("caller-supplied pass, approved, verified, and verdict fields are rejected at every depth", () => {
  for (const mutation of [
    { pass: true },
    { approved: true },
    { verified: true },
    { verdict: "pass" },
    { authority: { ...edgeDraft().authority, approved: true } },
    { from: { ...edgeDraft().from, verified: true } },
  ]) {
    assert.throws(
      () => buildReferenceChainEdge(edgeDraft(mutation)),
      /caller cannot set authority verdict field/i,
    );
  }
});

test("verification fails closed when an endpoint, Caseflow state, or repository revision drifts", async () => {
  const edge = buildReferenceChainEdge(edgeDraft());
  const mutations = [
    {
      from: { ...edge.from, contentDigest: "e".repeat(64) },
      expected: /source endpoint differs/i,
    },
    {
      to: { ...edge.to, recordId: "observation_cccccccccccccccccccccccc" },
      expected: /target endpoint differs/i,
    },
    {
      caseBinding: { ...edge.caseBinding, caseContentHash: "e".repeat(64) },
      expected: /Caseflow binding differs/i,
    },
    {
      repositoryBinding: { ...edge.repositoryBinding, commitSha: "2".repeat(40) },
      expected: /repository binding differs/i,
    },
    {
      attestationRefs: [],
      expected: /authority evidence differs/i,
    },
  ];

  for (const mutation of mutations) {
    const { expected, ...contextMutation } = mutation;
    await assert.rejects(
      () => verifyReferenceChainEdge(
        edge,
        verificationContext(edge, contextMutation),
      ),
      expected,
    );
  }
});

test("tampered derived identity, missing authority evidence, and unbounded evidence are rejected", async () => {
  const edge = buildReferenceChainEdge(edgeDraft());
  await assert.rejects(
    () => verifyReferenceChainEdge(
      { ...edge, contentDigest: "e".repeat(64) },
      verificationContext(edge),
    ),
    /content.?digest/i,
  );
  assert.throws(
    () => buildReferenceChainEdge(edgeDraft({
      authority: { kind: "externally-observed" },
    })),
    /authority.*evidence/i,
  );
  assert.throws(
    () => buildReferenceChainEdge(edgeDraft({
      authority: {
        kind: "deterministic",
        receiptRefs: Array.from({ length: 33 }, (_, index) =>
          recordRef(
            "nodekit.test-receipt/v1",
            "receiptId",
            `receipt:${index}`,
            index.toString(16).padStart(64, "0"),
          )),
      },
    })),
    /must NOT have more than 32 items/i,
  );
});

test("repeated verification is stateless and deterministic under burst load", async () => {
  const edge = buildReferenceChainEdge(edgeDraft());
  const results = await Promise.all(
    Array.from({ length: 250 }, () =>
      verifyReferenceChainEdge(edge, verificationContext(edge))),
  );
  assert.equal(results.length, 250);
  assert.equal(new Set(results.map((result) => result.contentDigest)).size, 1);
  assert.ok(results.every((result) => result.verified === true));
});
