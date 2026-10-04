import { normalizePortableValue, PORTABLE_VALUE_LIMITS, requireTrimmedText } from "./portable-value.mjs";
/** @typedef {{ artifactId: string, canonicalVersion: number, contentHash: string }} CompletionArtifactBinding */
/** @typedef {{ caseId: string, caseInputHash: string, artifactBindings: CompletionArtifactBinding[] }} CompletionExpected */
/** @param {unknown} value @param {string[]} keys @param {string} label */
function exactObject(value, keys, label) {
    if (value === null || typeof value !== "object" || Array.isArray(value)
        || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
        throw new TypeError(`${label} must contain exactly ${keys.join(", ")}`);
    }
    return /** @type {Record<string, unknown>} */ (value);
}
/** @param {unknown} value @param {string} label */
function completionHash(value, label) {
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
        throw new TypeError(`${label} must be a lowercase SHA-256 hash`);
    }
    return value;
}
/** Copy and validate before any asynchronous adapter work. @param {unknown} input */
export function normalizeCompletionExpected(input) {
    if (input === undefined)
        return undefined;
    const value = exactObject(normalizePortableValue(input, "expected"), ["caseId", "caseInputHash", "artifactBindings"], "expected");
    if (!Array.isArray(value.artifactBindings) || value.artifactBindings.length === 0) {
        throw new TypeError("expected.artifactBindings must be a nonempty array");
    }
    const seen = new Set();
    const artifactBindings = value.artifactBindings.map((entry) => {
        const binding = exactObject(entry, ["artifactId", "canonicalVersion", "contentHash"], "expected artifact binding");
        const artifactId = requireTrimmedText(binding.artifactId, "expected.artifactId");
        if (seen.has(artifactId))
            throw new Error("expected artifact IDs must be unique");
        seen.add(artifactId);
        if (typeof binding.canonicalVersion !== "number" || !Number.isSafeInteger(binding.canonicalVersion) || binding.canonicalVersion < 1) {
            throw new TypeError("expected canonicalVersion must be a positive safe integer");
        }
        return { artifactId, canonicalVersion: binding.canonicalVersion, contentHash: completionHash(binding.contentHash, "expected.contentHash") };
    }).sort((left, right) => compareCodeUnits(left.artifactId, right.artifactId));
    return {
        caseId: requireTrimmedText(value.caseId, "expected.caseId"),
        caseInputHash: completionHash(value.caseInputHash, "expected.caseInputHash"),
        artifactBindings,
    };
}
/**
 * Compare a bounded, complete actual set under the adapter's write fence.
 * @param {CompletionExpected} expected
 * @param {{ caseId: string, currentRunId: string | null, caseInputHash: string }} currentCase
 * @param {{ runId: string, caseId: string }} run
 * @param {CompletionArtifactBinding[]} actual
 */
export function assertCompletionExpected(expected, currentCase, run, actual) {
    if (actual.length > PORTABLE_VALUE_LIMITS.maxArrayItems)
        throw new Error("reviewed artifact set exceeds the portable limit");
    const sorted = [...actual].sort((left, right) => compareCodeUnits(left.artifactId, right.artifactId));
    if (currentCase.caseId !== expected.caseId || run.caseId !== expected.caseId
        || currentCase.currentRunId !== run.runId || currentCase.caseInputHash !== expected.caseInputHash
        || sorted.length !== expected.artifactBindings.length
        || sorted.some((entry, index) => {
            const binding = expected.artifactBindings[index];
            return entry.artifactId !== binding.artifactId || entry.canonicalVersion !== binding.canonicalVersion || entry.contentHash !== binding.contentHash;
        })) {
        throw new Error("current state does not match expected reviewed state");
    }
}
/**
 * Compare strings using JavaScript's stable UTF-16 code-unit ordering.
 *
 * Do not replace this with localeCompare: receipt hashes must not vary with the
 * host locale, ICU version, database collation, or provider query order.
 *
 * @param {string} left
 * @param {string} right
 */
export function compareCodeUnits(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}
/**
 * @template {{ aggregateId: string, aggregateType: string, eventId: string, sequence: number }} TEvent
 * @param {TEvent} left
 * @param {TEvent} right
 */
export function compareReceiptEventBindings(left, right) {
    return compareCodeUnits(left.aggregateType, right.aggregateType)
        || compareCodeUnits(left.aggregateId, right.aggregateId)
        || left.sequence - right.sequence
        || compareCodeUnits(left.eventId, right.eventId);
}
/**
 * Normalize every receipt binding before hashing it. The returned ID arrays
 * are intentionally derived from the normalized bindings so they cannot drift.
 *
 * @template {{ artifactId: string }} TArtifact
 * @template {{ proposalId: string }} TProposal
 * @template {{ approvalId: string }} TApproval
 * @template {{ aggregateId: string, aggregateType: string, eventId: string, sequence: number }} TEvent
 * @param {{
 *   approvalBindings: readonly TApproval[],
 *   artifactBindings: readonly TArtifact[],
 *   eventBindings: readonly TEvent[],
 *   proposalBindings: readonly TProposal[],
 * }} bindings
 */
export function normalizeReceiptBindings(bindings) {
    const artifactBindings = [...bindings.artifactBindings]
        .sort((left, right) => compareCodeUnits(left.artifactId, right.artifactId));
    const proposalBindings = [...bindings.proposalBindings]
        .sort((left, right) => compareCodeUnits(left.proposalId, right.proposalId));
    const approvalBindings = [...bindings.approvalBindings]
        .sort((left, right) => compareCodeUnits(left.approvalId, right.approvalId));
    const eventBindings = [...bindings.eventBindings].sort(compareReceiptEventBindings);
    return {
        approvalBindings,
        artifactBindings,
        artifactIds: artifactBindings.map((entry) => entry.artifactId),
        eventBindings,
        eventIds: eventBindings.map((entry) => entry.eventId),
        proposalBindings,
        proposalIds: proposalBindings.map((entry) => entry.proposalId),
    };
}
//# sourceMappingURL=receipt-bindings.mjs.map