import type { DealCandidate } from "./gmail-import";
const addressKey = (value: string | null) =>
  (value ?? "")
    .toLowerCase()
    .replace(
      /\b(street|avenue|road|drive|court|crescent)\b/g,
      (word) =>
        ({
          street: "st",
          avenue: "ave",
          road: "rd",
          drive: "dr",
          court: "ct",
          crescent: "cres",
        })[word]!,
    )
    .replace(/[^a-z0-9]/g, "");
export function mergeCandidates(
  existing: DealCandidate[],
  incoming: DealCandidate[],
): DealCandidate[] {
  const result = existing.map((item) => ({ ...item }));
  for (const candidate of incoming) {
    const match = result.find(
      (item) =>
        item.messageId === candidate.messageId ||
        (item.email.trim().toLowerCase() ===
          candidate.email.trim().toLowerCase() &&
          addressKey(item.propertyAddress) ===
            addressKey(candidate.propertyAddress) &&
          (!item.closingDate ||
            !candidate.closingDate ||
            item.closingDate === candidate.closingDate) &&
          (!item.side || !candidate.side || item.side === candidate.side)),
    );
    if (!match) {
      result.push({ ...candidate });
      continue;
    }
    match.sources = [
      ...new Set([...(match.sources ?? []), ...(candidate.sources ?? [])]),
    ];
    match.warnings = [
      ...new Set([...(match.warnings ?? []), ...(candidate.warnings ?? [])]),
    ];
    for (const field of ["price", "closingDate", "phone", "side"] as const) {
      if (match[field] == null)
        Object.assign(match, { [field]: candidate[field] });
      else if (candidate[field] != null && match[field] !== candidate[field])
        match.warnings.push(
          `Conflicting ${field}: ${match[field]} / ${candidate[field]}. Review source emails.`,
        );
    }
    if (candidate.status === "closed") match.status = "closed";
  }
  return result;
}
