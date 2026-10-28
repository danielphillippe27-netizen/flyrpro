/** Keep aligned with mac_contact_identifier and the native reader. No name matching. */
export function macIdentifier(raw?: string | null): string | null {
  const clean = (raw ?? '').trim().toLowerCase();
  if (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(clean)) return clean;
  if (!/^\+?[0-9() .-]+$/.test(clean)) return null;
  const digits = clean.replace(/[^0-9]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (clean.startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}
export type MacContact = { id: string; full_name: string; phone: string | null; email: string | null };
export function macIdentifierOwners(contacts: MacContact[]): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  for (const contact of contacts) {
    for (const raw of [contact.phone, contact.email]) {
      const value = macIdentifier(raw);
      if (!value) continue;
      const ids = owners.get(value) ?? new Set<string>();
      ids.add(contact.id); owners.set(value, ids);
    }
  }
  return owners;
}
export function uniqueMacIdentifiers(contact: MacContact, owners: Map<string, Set<string>>): string[] {
  return [...new Set([macIdentifier(contact.phone), macIdentifier(contact.email)])].filter((value): value is string =>
    value !== null && owners.get(value)?.size === 1 && owners.get(value)!.has(contact.id));
}
