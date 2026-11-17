export const REALTOR_CA_SENDERS = ['noreply@leads.realtor.ca', 'lead@realtor.ca'];

export function isRealtorCaSender(email: string | null) {
  return email !== null && REALTOR_CA_SENDERS.includes(email);
}

export function realtorCaInboundDomain() {
  return (process.env.RESEND_INBOUND_DOMAIN?.trim() || 'wolfgrid.app').toLowerCase();
}

export function realtorCaInboundConfigured() {
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.RESEND_WEBHOOK_SECRET?.trim());
}

export function realtorCaRouteToken(address: string) {
  const [local, domain, extra] = address.toLowerCase().split('@');
  if (domain !== realtorCaInboundDomain() || extra !== undefined) return null;
  return local.match(/^realtorca-([0-9a-f]{32})$/)?.[1] ?? null;
}

function emailAddress(value: string) {
  const email = (value.match(/<([^<>]+)>/)?.[1] ?? value).trim().toLowerCase();
  return /^[^\s<>,@]+@[^\s<>,@]+\.[^\s<>,@]+$/.test(email) ? email : null;
}

export function inboundEmailText(html: string) {
  return html
    .replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<br\b[^>]*>|<\/(?:p|div|td|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:amp|nbsp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, (entity) => {
      const named: Record<string, string> = {
        '&amp;': '&', '&nbsp;': ' ', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>',
      };
      if (entity[1] !== '#') return named[entity.toLowerCase()];
      const code = entity[2].toLowerCase() === 'x'
        ? parseInt(entity.slice(3, -1), 16)
        : Number(entity.slice(2, -1));
      return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

export function parseRealtorCaInquiry(input: {
  from: string;
  subject: string;
  text: string;
  html: string;
  replyTo: string[];
}) {
  if (!isRealtorCaSender(emailAddress(input.from))) return null;
  const text = input.html ? inboundEmailText(input.html) : input.text;
  const heading = text.match(/^Message from[ \t]+([^\r\n]{1,160}?)[ \t]*:[ \t]*\r?$/im);
  const name = heading?.[1].trim();
  if (!heading || !name) return null;

  const message = text.slice((heading.index ?? 0) + heading[0].length)
    .split(/^\s*(?:More about .+?:|Contact Information:)\s*$/im)[0].trim();

  const contactBlock = text.match(/^Contact Information:\s*([\s\S]*?)(?=^How was this lead\?|$(?![\s\S]))/im)?.[1] ?? '';
  const htmlContactBlock = input.html.split(/Contact Information:/i)[1]?.split(/How was this lead/i)[0] ?? '';
  const mailto = htmlContactBlock.match(/href\s*=\s*["']?mailto:([^"'?<>\s]+)/i)?.[1];
  const plainEmail = contactBlock.match(/[^\s<>:@]+@[^\s<>:@]+\.[a-z]{2,}/i)?.[0];
  const email = [...input.replyTo, mailto ?? '', plainEmail ?? '']
    .map(emailAddress)
    .find((value) => value && !/@(?:[^@]+\.)?realtor\.ca$/i.test(value)) ?? null;
  const phone = contactBlock.match(/(?:\+?1[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]?\d{3}[ .-]?\d{4}\b/)?.[0] ?? null;
  if (!email && !phone) return null;

  const listing = input.subject.match(/\b(?:general inquiry|showing request) for (.+?)(?:,\s*#[a-z]+\d+)?$/i)?.[1] ?? null;
  const mls = input.subject.match(/#([a-z]+\d+)\s*$/i)?.[1] ?? null;
  return { name, email, phone, listing, mls, message };
}
