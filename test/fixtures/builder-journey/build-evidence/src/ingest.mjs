// Fixture slice: file-upload ingestion for the salon weekly brief.
// Read-only by construction — there is no network client and no writer in this module.

export const SUPPORTED_INPUTS = Object.freeze(["bank_csv", "square_export", "payroll_summary", "receipt_images"]);

// dec-receipt-ocr-threshold: receipts scoring below this are surfaced as unmatched
// rather than auto-matched. Disclosed in evidence/disclosures.md.
export const RECEIPT_MATCH_THRESHOLD = 0.82;

export function parseBankCsv(text) {
  const [header, ...rows] = text.trim().split("\n");
  const columns = header.split(",").map((name) => name.trim());
  return rows.filter(Boolean).map((row) => {
    const cells = row.split(",");
    return Object.fromEntries(columns.map((name, index) => [name, cells[index]?.trim() ?? ""]));
  });
}

export function classify(row) {
  // The contract prohibits categorizing spending without owner confirmation, so this
  // returns a proposal, never a committed category.
  return { status: "proposed", category: row.memo ? "uncategorized" : "unknown", requiresOwnerConfirmation: true };
}
