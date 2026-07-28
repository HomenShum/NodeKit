// Fixture slice: the weekly brief itself.
//
// The OpportunityContract asked for a "Verified Weekly Salon Brief". This module produces an
// ESTIMATED brief and labels it so. Receipt coverage is partial, so "Verified" would be a word
// the artifact cannot support. The contradiction is reported in evidence/contradiction-notice.md.

import { RECEIPT_MATCH_THRESHOLD, classify } from "./ingest.mjs";

export const BRIEF_LABEL = "Estimated Weekly Salon Brief";

// dec-week-boundary: Monday 00:00 through Sunday 23:59 in the salon's local timezone.
export const WEEK_BOUNDARY = Object.freeze({ startsOn: "monday", timezone: "salon-local" });

export function buildWeeklyBrief({ bankRows = [], squareRows = [], payroll = 0, receipts = [] }) {
  const sales = squareRows.reduce((total, row) => total + Number(row.gross ?? 0), 0);
  const spend = bankRows.reduce((total, row) => total + Math.abs(Number(row.debit ?? 0)), 0);
  const matched = receipts.filter((receipt) => Number(receipt.confidence ?? 0) >= RECEIPT_MATCH_THRESHOLD);

  return {
    label: BRIEF_LABEL,
    estimatedOperatingProfit: sales - spend - payroll,
    verificationQueue: bankRows.filter((row) => !row.receiptId).map((row) => ({ row, proposal: classify(row) })),
    receiptCoverage: receipts.length === 0 ? 0 : matched.length / receipts.length,
    sourceLinks: bankRows.map((row) => row.sourceRef).filter(Boolean),
  };
}
