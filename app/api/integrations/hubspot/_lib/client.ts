const HUBSPOT_API_BASE =
  process.env.HUBSPOT_API_BASE?.trim().replace(/\/$/, '') || 'https://api.hubapi.com';

const HUBSPOT_CONTACTS_URL = `${HUBSPOT_API_BASE}/crm/v3/objects/contacts`;
const HUBSPOT_CONTACT_SEARCH_URL = `${HUBSPOT_CONTACTS_URL}/search`;
const HUBSPOT_NOTES_URL = `${HUBSPOT_API_BASE}/crm/v3/objects/notes`;
const HUBSPOT_TASKS_URL = `${HUBSPOT_API_BASE}/crm/v3/objects/tasks`;
const HUBSPOT_APPOINTMENTS_URL = `${HUBSPOT_API_BASE}/crm/v3/objects/appointments`;

const HUBSPOT_NOTE_TO_CONTACT_ASSOCIATION_TYPE_ID = 202;
const HUBSPOT_TASK_TO_CONTACT_ASSOCIATION_TYPE_ID = 204;
const HUBSPOT_APPOINTMENT_TO_CONTACT_ASSOCIATION_TYPE_ID = 906;

export type HubSpotLeadPayload = {
  id?: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  source?: string | null;
  notes?: string | null;
  task?: {
    title?: string | null;
    due_date?: string | null;
  } | null;
  appointment?: {
    date?: string | null;
    title?: string | null;
    notes?: string | null;
    location?: string | null;
  } | null;
};

export type HubSpotValidationResult = {
  accountName?: string | null;
  userEmail?: string | null;
};

export type HubSpotUpsertResult = {
  contactId: string;
  action: 'created' | 'updated';
  raw: unknown;
};

export type HubSpotEngagementResult = {
  id: string;
  raw: unknown;
};

export class HubSpotAPIError extends Error {
  kind: 'invalid_token' | 'network' | 'api';
  status?: number;

  constructor(kind: 'invalid_token' | 'network' | 'api', message: string, status?: number) {
    super(message);
    this.name = 'HubSpotAPIError';
    this.kind = kind;
    this.status = status;
  }
}

export class HubSpotTokenValidator {
  constructor(private readonly client: HubSpotAPIClient) {}

  async validate(token: string): Promise<HubSpotValidationResult> {
    return this.client.validateToken(token);
  }
}

export class HubSpotAPIClient {
  async validateToken(token: string): Promise<HubSpotValidationResult> {
    await this.requestJson(
      `${HUBSPOT_CONTACTS_URL}?limit=1&properties=email,firstname,lastname`,
      { method: 'GET' },
      token
    );

    return {
      accountName: null,
      userEmail: null,
    };
  }

  async createContact(token: string, lead: HubSpotLeadPayload): Promise<HubSpotUpsertResult> {
    const payload = {
      properties: buildHubSpotContactProperties(lead),
    };
    const res = await this.requestJson(
      HUBSPOT_CONTACTS_URL,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      token
    );

    const contactId = extractHubSpotContactId(res.body);
    if (!contactId) {
      throw new HubSpotAPIError('api', 'HubSpot did not return a contact ID for the created record.');
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
    lead: HubSpotLeadPayload
  ): Promise<HubSpotUpsertResult> {
    const payload = {
      properties: buildHubSpotContactProperties(lead),
    };
    const res = await this.requestJson(
      `${HUBSPOT_CONTACTS_URL}/${encodeURIComponent(contactId)}`,
      {
        method: 'PATCH',
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

  async findContactByEmail(token: string, email: string): Promise<string | null> {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) return null;

    try {
      const res = await this.requestJson(
        `${HUBSPOT_CONTACTS_URL}/${encodeURIComponent(trimmedEmail)}?idProperty=email&properties=email,phone,firstname,lastname`,
        { method: 'GET' },
        token
      );
      return extractHubSpotContactId(res.body);
    } catch (error) {
      if (error instanceof HubSpotAPIError && error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  async findContactByPhone(token: string, phone: string): Promise<string | null> {
    const trimmedPhone = phone.trim();
    if (!trimmedPhone) return null;

    for (const propertyName of ['phone', 'mobilephone']) {
      const res = await this.requestJson(
        HUBSPOT_CONTACT_SEARCH_URL,
        {
          method: 'POST',
          body: JSON.stringify({
            filterGroups: [
              {
                filters: [
                  {
                    propertyName,
                    operator: 'EQ',
                    value: trimmedPhone,
                  },
                ],
              },
            ],
            limit: 1,
            properties: ['email', 'phone', 'firstname', 'lastname'],
          }),
        },
        token
      );

      const result = extractHubSpotSearchResultId(res.body);
      if (result) return result;
    }

    return null;
  }

  async createNote(token: string, contactId: string, noteBody: string): Promise<HubSpotEngagementResult> {
    const trimmedNote = noteBody.trim();
    if (!trimmedNote) {
      throw new HubSpotAPIError('api', 'HubSpot note body is required.');
    }

    const res = await this.requestJson(
      HUBSPOT_NOTES_URL,
      {
        method: 'POST',
        body: JSON.stringify({
          properties: {
            hs_timestamp: new Date().toISOString(),
            hs_note_body: trimmedNote,
          },
          associations: [buildHubSpotAssociation(contactId, HUBSPOT_NOTE_TO_CONTACT_ASSOCIATION_TYPE_ID)],
        }),
      },
      token
    );

    const id = extractHubSpotContactId(res.body);
    if (!id) {
      throw new HubSpotAPIError('api', 'HubSpot did not return a note ID.');
    }

    return { id, raw: res.body };
  }

  async createTask(
    token: string,
    contactId: string,
    task: { title?: string | null; due_date?: string | null; body?: string | null }
  ): Promise<HubSpotEngagementResult> {
    const dueDateTime = normalizeDueDateTime(task.due_date);
    if (!dueDateTime) {
      throw new HubSpotAPIError('api', 'HubSpot follow-up task requires a valid due date.');
    }

    const res = await this.requestJson(
      HUBSPOT_TASKS_URL,
      {
        method: 'POST',
        body: JSON.stringify({
          properties: compactRecord({
            hs_timestamp: dueDateTime,
            hs_task_subject: task.title?.trim() || 'FLYR Follow-up',
            hs_task_body: cleanedValue(task.body),
            hs_task_status: 'NOT_STARTED',
            hs_task_priority: 'HIGH',
            hs_task_type: 'TODO',
          }),
          associations: [buildHubSpotAssociation(contactId, HUBSPOT_TASK_TO_CONTACT_ASSOCIATION_TYPE_ID)],
        }),
      },
      token
    );

    const id = extractHubSpotContactId(res.body);
    if (!id) {
      throw new HubSpotAPIError('api', 'HubSpot did not return a task ID.');
    }

    return { id, raw: res.body };
  }

  async createAppointment(
    token: string,
    contactId: string,
    appointment: {
      date?: string | null;
      title?: string | null;
      notes?: string | null;
      location?: string | null;
    }
  ): Promise<HubSpotEngagementResult> {
    const startDateTime = normalizeIsoDateTime(appointment.date);
    if (!startDateTime) {
      throw new HubSpotAPIError('api', 'HubSpot appointment requires a valid date.');
    }

    const endDateTime = new Date(new Date(startDateTime).getTime() + 60 * 60 * 1000).toISOString();
    const appointmentName = appointment.title?.trim() || 'FLYR Appointment';
    const res = await this.requestJson(
      HUBSPOT_APPOINTMENTS_URL,
      {
        method: 'POST',
        body: JSON.stringify({
          properties: compactRecord({
            hs_appointment_name: appointmentName,
            hs_timestamp: startDateTime,
            hs_appointment_start: startDateTime,
            hs_appointment_end: endDateTime,
            hs_appointment_status: 'SCHEDULED',
          }),
          associations: [buildHubSpotAssociation(contactId, HUBSPOT_APPOINTMENT_TO_CONTACT_ASSOCIATION_TYPE_ID)],
        }),
      },
      token
    );

    const id = extractHubSpotContactId(res.body);
    if (!id) {
      throw new HubSpotAPIError('api', 'HubSpot did not return an appointment ID.');
    }

    const timelineNote = buildHubSpotAppointmentNote(appointment, startDateTime, endDateTime);
    if (timelineNote) {
      await this.createNote(token, contactId, timelineNote);
    }

    return { id, raw: res.body };
  }

  async createMeeting(
    token: string,
    contactId: string,
    appointment: {
      date?: string | null;
      title?: string | null;
      notes?: string | null;
      location?: string | null;
    }
  ): Promise<HubSpotEngagementResult> {
    return this.createAppointment(token, contactId, appointment);
  }

  private async requestJson(
    url: string,
    init: RequestInit,
    token: string
  ): Promise<{ body: unknown; response: Response }> {
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      throw new HubSpotAPIError('invalid_token', 'HubSpot token is missing.');
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
      throw new HubSpotAPIError(
        'network',
        'Unable to connect to HubSpot. Please try again.'
      );
    }

    const rawText = await response.text();
    const body = rawText.trim() ? safeJsonParse(rawText) : null;

    if (!response.ok) {
      throw normalizeHubSpotError(response.status, body, rawText);
    }

    return { body, response };
  }
}

export function buildHubSpotContactProperties(
  lead: HubSpotLeadPayload
): Record<string, unknown> {
  const { firstName, lastName } = splitFullName(lead.name);
  const properties = compactRecord({
    email: cleanedValue(lead.email),
    firstname: firstName || undefined,
    lastname: lastName || undefined,
    phone: cleanedValue(lead.phone),
    address: cleanedValue(lead.address),
  });

  if (!properties.email && !properties.firstname && !properties.lastname) {
    throw new HubSpotAPIError(
      'api',
      'HubSpot requires at least an email or a contact name.'
    );
  }

  return properties;
}

export function extractHubSpotContactId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;

  const directId = record.id;
  if (directId != null && `${directId}`.trim()) {
    return `${directId}`.trim();
  }

  for (const key of ['result', 'data']) {
    const nestedValue = record[key];
    const nestedId = extractHubSpotContactId(nestedValue);
    if (nestedId) return nestedId;
  }

  return null;
}

function extractHubSpotSearchResultId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const results = record.results;
  if (!Array.isArray(results) || results.length === 0) return null;
  return extractHubSpotContactId(results[0]);
}

function normalizeHubSpotError(
  status: number,
  payload: unknown,
  rawText?: string
): HubSpotAPIError {
  const message =
    pickString(payload, ['message', 'error', 'detail', 'details']) ||
    rawText?.trim() ||
    `HubSpot returned ${status}.`;

  if (status === 401 || status === 403) {
    return new HubSpotAPIError(
      'invalid_token',
      'Invalid token or missing required HubSpot scopes.',
      status
    );
  }

  if (status >= 500) {
    return new HubSpotAPIError(
      'network',
      'Unable to connect to HubSpot. Please try again.',
      status
    );
  }

  return new HubSpotAPIError('api', sanitizeHubSpotMessage(message), status);
}

function sanitizeHubSpotMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return 'HubSpot request failed.';
  if (/unauthorized|forbidden|invalid token|authentication/i.test(trimmed)) {
    return 'Invalid token or missing required HubSpot scopes.';
  }
  return trimmed;
}

function buildHubSpotAssociation(contactId: string, associationTypeId: number) {
  return {
    to: {
      id: contactId,
    },
    types: [
      {
        associationCategory: 'HUBSPOT_DEFINED',
        associationTypeId,
      },
    ],
  };
}

function cleanedValue(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function buildHubSpotAppointmentNote(
  appointment: {
    title?: string | null;
    notes?: string | null;
    location?: string | null;
  },
  startDateTime: string,
  endDateTime: string
): string | null {
  const lines = [
    appointment.title?.trim() ? `Appointment: ${appointment.title.trim()}` : 'Appointment: FLYR Appointment',
    `Start: ${startDateTime}`,
    `End: ${endDateTime}`,
    appointment.location?.trim() ? `Location: ${appointment.location.trim()}` : null,
    appointment.notes?.trim() ? `Notes: ${appointment.notes.trim()}` : null,
  ].filter((value): value is string => Boolean(value));

  return lines.length ? lines.join('\n') : null;
}

function normalizeIsoDateTime(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function normalizeDueDateTime(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  if (trimmed.includes('T')) {
    return normalizeIsoDateTime(trimmed);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T17:00:00.000Z`;
  }

  return normalizeIsoDateTime(trimmed);
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
