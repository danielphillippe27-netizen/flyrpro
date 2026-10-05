export function buildKimiCocoPayload(
  row: Record<string, unknown>,
  sourceWorkspaceId: string,
  version: number,
) {
  const text = (field: string) =>
    typeof row[field] === "string" ? String(row[field]).trim() || null : null;
  const parts = (text("full_name") || text("name") || "")
    .split(/\s+/)
    .filter(Boolean);
  const explicitFirst = text("first_name");
  const explicitLast = text("last_name");
  return {
    sourceWorkspaceId,
    contactId: row.id,
    version,
    first_name: explicitFirst ?? (explicitLast ? "" : (parts[0] ?? "")),
    last_name: explicitLast ?? (explicitFirst ? "" : parts.slice(1).join(" ")),
    address: text("address"),
    email: text("email"),
    phone: text("phone"),
    notes: text("notes"),
    campaign_id: text("campaign_id"),
    appointment_at: text("appointment_at"),
    appointment_title: text("appointment_title"),
    appointment_notes: text("appointment_notes"),
    appointment_location: text("appointment_location"),
    follow_up_at: text("follow_up_at") ?? text("reminder_date"),
    follow_up_title: text("follow_up_title"),
    follow_up_notes: text("follow_up_notes"),
  };
}
