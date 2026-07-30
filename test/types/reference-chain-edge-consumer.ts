import {
  buildReferenceChainEdge,
  verifyReferenceChainEdge,
  type ReferenceChainEdgeDraftV1,
  type ReferenceChainEdgeV1,
  type ReferenceChainRecordRefV1,
} from "@homenshum/nodekit/reference-loop";

declare const draft: ReferenceChainEdgeDraftV1;
declare const ref: ReferenceChainRecordRefV1;

const edge: ReferenceChainEdgeV1 = buildReferenceChainEdge(draft);
edge.schemaVersion satisfies "nodekit.reference-chain-edge/v1";
edge.from.idField satisfies ReferenceChainRecordRefV1["idField"];

void verifyReferenceChainEdge(edge, {
  from: ref,
  to: ref,
  caseBinding: edge.caseBinding,
  repositoryBinding: edge.repositoryBinding,
  ...(edge.authority.attestationRefs
    ? { attestationRefs: edge.authority.attestationRefs }
    : {}),
  ...(edge.authority.receiptRefs
    ? { receiptRefs: edge.authority.receiptRefs }
    : {}),
});
