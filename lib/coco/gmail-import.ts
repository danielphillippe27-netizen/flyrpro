export type DealCandidate = {
  messageId: string;
  email: string;
  name: string;
  subject: string;
  evidenceExcerpt: string;
  messageDate: string;
  propertyAddress: string | null;
  side: "buyer" | "seller" | null;
  price: number | null;
  closingDate: string | null;
  phone?: string | null;
  confidence?: string;
  warnings?: string[];
  status?: string;
  sources?: string[];
  notes?: string | null;
};

type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
};
type GmailMessage = {
  id: string;
  internalDate?: string;
  snippet?: string;
  payload?: GmailPart & { headers?: { name: string; value: string }[] };
};

function textBody(part?: GmailPart): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data)
    return Buffer.from(part.body.data, "base64url")
      .toString("utf8")
      .slice(0, 12000);
  for (const child of part.parts ?? []) {
    const found = textBody(child);
    if (found) return found;
  }
  return "";
}

function field(message: GmailMessage, key: string): string {
  return (
    message.payload?.headers?.find(
      (header) => header.name.toLowerCase() === key.toLowerCase(),
    )?.value ?? ""
  );
}

function participant(
  raw: string,
  ownEmail: string,
): { email: string; name: string } | null {
  const match = raw.match(
    /^\s*(.*?)\s*<([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>/i,
  );
  const bare = !match
    ? raw.match(/\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i)
    : null;
  const email = (match?.[2] ?? bare?.[1] ?? "").toLowerCase();
  if (!email) return null;
  if (
    email === ownEmail.toLowerCase() ||
    /^(?:no-?reply|newsletter|notifications|info|support|admin|team|office|reception|marketing|billing)@/i.test(
      email,
    )
  )
    return null;
  const name = (match?.[1] ?? email.split("@")[0].replace(/[._+-]+/g, " "))
    .replace(/["']/g, "")
    .trim();
  return name ? { email, name: name.slice(0, 100) } : null;
}

export function dealCandidate(
  message: GmailMessage,
  ownEmail: string,
): DealCandidate | null {
  const subject = field(message, "Subject").slice(0, 200);
  const body = textBody(message.payload) || message.snippet || "";
  const sample = `${subject}\n${body.slice(0, 5000)}`;
  if (
    !/\b(closed|closing|completion date|completed sale|sale completed|sold|possession|final statement|statement of adjustments)\b/i.test(
      sample,
    )
  )
    return null;
  if (
    /\b(open house|newsletter|market report|just listed|new listing|unsubscribe)\b/i.test(
      subject,
    )
  )
    return null;
  const person =
    participant(field(message, "From"), ownEmail) ||
    participant(field(message, "To"), ownEmail);
  if (!person) return null;
  const addressMatch = sample.match(
    /(?:property(?: address)?|home at|located at)\s*[:\-]?\s*([^\n.;]{7,110})/i,
  );
  const priceMatch = sample.match(
    /(?:purchase price|sale price|sold for|closing price)\s*[:\-]?\s*\$?([\d,]{5,12})(?:\.\d{2})?/i,
  );
  const dateMatch = sample.match(
    /(?:closing date|completion date|closed on)\s*[:\-]?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})/i,
  );
  const parsedDate = dateMatch ? new Date(dateMatch[1]) : null;
  const price = priceMatch ? Number(priceMatch[1].replaceAll(",", "")) : null;
  const evidenceStart = Math.max(
    0,
    sample.search(
      /\b(closed|closing|completion date|completed sale|sale completed|sold|possession|final statement|statement of adjustments)\b/i,
    ) - 50,
  );
  return {
    messageId: message.id,
    email: person.email,
    name: person.name,
    subject,
    evidenceExcerpt: sample
      .slice(evidenceStart, evidenceStart + 300)
      .replace(/\s+/g, " "),
    messageDate: message.internalDate
      ? new Date(Number(message.internalDate)).toISOString()
      : "",
    propertyAddress: addressMatch?.[1].trim().slice(0, 160) ?? null,
    side: /\b(buyer|purchaser)\b/i.test(sample)
      ? "buyer"
      : /\b(seller|vendor)\b/i.test(sample)
        ? "seller"
        : null,
    price: price && price >= 10000 && price <= 100000000 ? price : null,
    closingDate:
      parsedDate && !Number.isNaN(parsedDate.getTime())
        ? parsedDate.toISOString().slice(0, 10)
        : null,
  };
}
