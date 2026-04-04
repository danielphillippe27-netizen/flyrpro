export const BOLDTRAIL_API_BASE =
  process.env.BOLDTRAIL_API_BASE?.trim().replace(/\/$/, '') || 'https://api.kvcore.com';

const BOLDTRAIL_CONTACTS_URL = `${BOLDTRAIL_API_BASE}/v2/public/contacts`;
const BOLDTRAIL_CONTACT_URL = `${BOLDTRAIL_API_BASE}/v2/public/contact`;

export type BoldTrailLeadPayload = {
  id?: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  source?: string | null;
  notes?: string | null;
};

export type BoldTrailValidationResult = {
  accountName?: string | null;
  userEmail?: string | null;
};

export type BoldTrailUpsertResult = {
  contactId: string;
  action: 'created' | 'updated';
  raw: unknown;
};

export type BoldTrailAppointmentPayload = {
  title?: string | null;
  date?: string | null;
  notes?: string | null;
};

export type BoldTrailFollowUpPayload = {
  notes?: string | null;
  dueDate?: string | null;
};

export class BoldTrailAPIError extends Error {
  kind: 'invalid_token' | 'network' | 'api';
  status?: number;

  constructor(kind: 'invalid_token' | 'network' | 'api', message: string, status?: number) {
    super(message);
    this.name = 'BoldTrailAPIError';
    this.kind = kind;
    this.status = status;
  }
}

export class BoldTrailTokenValidator {
  constructor(private readonly client: BoldTrailAPIClient) {}

  async validate(token: string): Promise<BoldTrailValidationResult> {
    return this.client.validateToken(token);
  }
}

export class BoldTrailAPIClient {
  async validateToken(token: string): Promise<BoldTrailValidationResult> {
    const res = await this.requestJson(
      `${BOLDTRAIL_CONTACTS_URL}?limit=1`,
      { method: 'GET' },
      token
    );

    return {
      accountName: pickString(res.body, ['account_name', 'accountName', 'company', 'office_name']),
      userEmail: pickString(res.body, ['user_email', 'userEmail', 'email']),
    };
  }

  async createContact(token: string, lead: BoldTrailLeadPayload): Promise<BoldTrailUpsertResult> {
    const payload = buildBoldTrailContactPayload(lead);
    const res = await this.requestJson(
      BOLDTRAIL_CONTACT_URL,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token
    );

    const contactId = extractBoldTrailContactId(res.body);
    if (!contactId) {
      throw new BoldTrailAPIError(
        'api',
        'BoldTrail did not return a contact ID for the created record.'
      );
    }

    return {
      contactId,
      action: 'created',
      raw: res.body,
    };
  }

  async updateContact(
    token: string,
    contactId: string,
    lead: BoldTrailLeadPayload
  ): Promise<BoldTrailUpsertResult> {
    const payload = buildBoldTrailContactPayload(lead);
    const res = await this.requestJson(
      `${BOLDTRAIL_CONTACT_URL}/${encodeURIComponent(contactId)}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      },
      token
    );

    return {
      contactId,
      action: 'updated',
      raw: res.body,
    };
  }

  async addNote(token: string, contactId: string, note: string): Promise<void> {
    const trimmedNote = note.trim();
    if (!trimmedNote) return;

    await this.requestJson(
      `${BOLDTRAIL_CONTACT_URL}/${encodeURIComponent(contactId)}/action/note`,
      {
        method: 'PUT',
        body: JSON.stringify({
          details: trimmedNote,
        }),
      },
      token
    );
  }

  private async requestJson(
    url: string,
    init: RequestInit,
    token: string
  ): Promise<{ body: unknown; response: Response }> {
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      throw new BoldTrailAPIError('invalid_token', 'BoldTrail token is missing.');
    }

    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${trimmedToken}`,
          'Content-Type': 'application/json',
          ...(init.headers ?? {}),
        },
      });
    } catch {
      throw new BoldTrailAPIError(
        'network',
        'Unable to connect to BoldTrail. Please try again.'
      );
    }

    const rawText = await response.text();
    const body = rawText.trim() ? safeJsonParse(rawText) : null;

    if (!response.ok) {
      throw normalizeBoldTrailError(response.status, body, rawText);
    }

    return { body, response };
  }
}

export function buildBoldTrailContactPayload(
  lead: BoldTrailLeadPayload
): Record<string, unknown> {
  const { firstName, lastName } = splitFullName(lead.name);

  return compactRecord({
    first_name: firstName,
    last_name: lastName,
    email: cleanedValue(lead.email),
    cell_phone_1: cleanedValue(lead.phone),
    primary_address: cleanedValue(lead.address),
    source: cleanedValue(lead.source) || 'FLYR',
    capture_method: 'FLYR',
    external_vendor_id: cleanedValue(lead.id),
  });
}

export function extractBoldTrailContactId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;

  for (const key of ['id', 'contact_id', 'contactId']) {
    const value = record[key];
    if (value != null && `${value}`.trim()) return `${value}`.trim();
  }

  for (const key of ['data', 'contact', 'result']) {
    const nestedValue = record[key];
    const nestedId = extractBoldTrailContactId(nestedValue);
    if (nestedId) return nestedId;
  }

  return null;
}

export function buildBoldTrailFollowUpNote(
  followUp: string | BoldTrailFollowUpPayload | null | undefined
): string | null {
  if (typeof followUp === 'string') {
    const trimmed = followUp.trim();
    return trimmed ? `Follow Up\n\n${trimmed}` : null;
  }

  const notes = followUp?.notes?.trim();
  const dueDate = normalizeDisplayDate(followUp?.dueDate);
  const parts = ['Follow Up'];

  if (dueDate) parts.push(`Due: ${dueDate}`);
  if (notes) parts.push(notes);

  return parts.length > 1 ? parts.join('\n\n') : null;
}

export function buildBoldTrailAppointmentNote(
  appointment: BoldTrailAppointmentPayload | null | undefined
): string | null {
  const title = appointment?.title?.trim();
  const when = normalizeDisplayDate(appointment?.date);
  const notes = appointment?.notes?.trim();
  const parts = ['Appointment'];

  if (title) parts.push(`Title: ${title}`);
  if (when) parts.push(`When: ${when}`);
  if (notes) parts.push(notes);

  return parts.length > 1 ? parts.join('\n\n') : null;
}

export function normalizeBoldTrailError(
  status: number,
  payload: unknown,
  rawText?: string
): BoldTrailAPIError {
  const message =
    pickString(payload, ['message', 'error', 'detail', 'details']) ||
    rawText?.trim() ||
    `BoldTrail returned ${status}.`;

  if (status === 401 || status === 403) {
    return new BoldTrailAPIError('invalid_token', 'Invalid token', status);
  }

  if (status >= 500) {
    return new BoldTrailAPIError(
      'network',
      'Unable to connect to BoldTrail. Please try again.',
      status
    );
  }

  return new BoldTrailAPIError('api', sanitizeBoldTrailMessage(message), status);
}

function sanitizeBoldTrailMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return 'BoldTrail request failed.';
  if (/unauthorized|forbidden|invalid token|invalid api/i.test(trimmed)) {
    return 'Invalid token';
  }
  return trimmed;
}

function normalizeDisplayDate(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  return trimmed;
}

function cleanedValue(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function splitFullName(fullName: string | null | undefined): {
  firstName: string;
  lastName: string;
} {
  const trimmed = fullName?.trim() || '';
  if (!trimmed) {
    return { firstName: '', lastName: '' };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

function pickString(payload: unknown, keys: string[]): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;

  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') {
      const nested = pickString(value, keys);
      if (nested) return nested;
    }
  }

  return null;
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
