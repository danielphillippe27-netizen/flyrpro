export type OutreachContact = { id: string; full_name: string; phone?: string | null; phone_e164?: string | null; email?: string | null; address?: string | null };
export type OutreachMode = 'call' | 'message' | 'email';
export function phoneDestination(raw?: string | null): string | null {
  const base = (raw ?? '').trim().split(/ext\.?|[x,;#]/i)[0];
  const digits = base.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return `${base.startsWith('+') ? '+' : ''}${digits}`;
}
export function emailDestination(raw?: string | null): string | null {
  const email = (raw ?? '').trim();
  return /^[^\s@<>?,;]+@[^\s@<>?,;]+\.[^\s@<>?,;]+$/.test(email) ? email : null;
}
export function recipientsFor(contacts: OutreachContact[], mode: OutreachMode): OutreachContact[] {
  const seen = new Set<string>();
  return contacts.filter(contact => {
    const value = mode === 'email' ? emailDestination(contact.email)?.toLowerCase() : phoneDestination(contact.phone_e164 || contact.phone)?.replace(/^\+?1(?=\d{10}$)/, '').replace(/^\+/, '');
    if (!value || seen.has(value)) return false;
    seen.add(value); return true;
  });
}
export function nativeContactUrl(contact: OutreachContact, mode: 'call' | 'message'): string | null {
  const phone = phoneDestination(contact.phone_e164 || contact.phone);
  return phone ? `${mode === 'call' ? 'tel' : 'sms'}:${phone}` : null;
}
