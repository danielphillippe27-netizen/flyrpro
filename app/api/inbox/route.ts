import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { asUuid, getWorkspaceRole } from '@/app/api/routes/_lib';
import {
  DEMO_EMAIL_DOMAIN,
  resolveAvailableDemoEmailHandle,
  type HandleLookupClient,
} from '@/lib/dialer/demo-email-handle';
import { normalizePhoneNumber } from '@/lib/dialer/phone';
import { createAdminClient } from '@/lib/supabase/server';
import type { InboxItem, InboxItemSource, InboxItemStatus } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ApiInboxItem = {
  id: string;
  source: InboxItemSource;
  direction: 'inbound' | 'outbound' | null;
  title: string;
  preview: string | null;
  body: string | null;
  fromLabel: string | null;
  fromEmail: string | null;
  fromPhone: string | null;
  toLabel: string | null;
  toEmail: string | null;
  toPhone: string | null;
  status: InboxItemStatus;
  occurredAt: string;
  readAt: string | null;
  contactId: string | null;
  href: string | null;
};

type DialerInboundMessageRow = {
  id: string;
  contact_id: string | null;
  from_number_e164: string;
  to_number_e164: string;
  body: string;
  received_at: string;
  read_at: string | null;
};

type ContactSummaryRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  phone_e164: string | null;
  email?: string | null;
};

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

type SalespersonEmailRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  workspace_id: string | null;
  demo_email_handle: string | null;
};

type InboxEmailContactRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

const COMMUNICATION_SOURCES = new Set<InboxItemSource>(['email', 'sms', 'call']);
const VALID_SOURCE_FILTERS = new Set(['all', 'email', 'sms', 'call']);
const VALID_STATUS_FILTERS = new Set(['open', 'done', 'snoozed', 'archived', 'all']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_SUBJECT_LENGTH = 320;
const MAX_EMAIL_BODY_LENGTH = 20_000;

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getEnv(name: string): string | null {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeEmail(value: unknown): string | null {
  const normalized = cleanText(value).toLowerCase();
  return EMAIL_PATTERN.test(normalized) ? normalized : null;
}

function safeSenderName(value: string | null | undefined, fallbackEmail: string | null): string {
  const fallback = fallbackEmail?.split('@')[0]?.replace(/[._+-]+/g, ' ').trim() || 'WolfGrid';
  return (cleanText(value) || fallback || 'WolfGrid')
    .replace(/[\r\n<>"]/g, '')
    .slice(0, 80);
}

async function resolveSalespersonEmailRoute(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  requestUser: { id: string; email: string | null }
): Promise<SalespersonEmailRow | null> {
  const select = 'id, full_name, email, workspace_id, demo_email_handle';
  const email = normalizeEmail(requestUser.email);

  if (email) {
    const { data, error } = await admin
      .from('salespeople')
      .select(select)
      .eq('workspace_id', workspaceId)
      .ilike('email', email)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data as SalespersonEmailRow;
  }

  const { data, error } = await admin
    .from('salespeople')
    .select(select)
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as SalespersonEmailRow | null) ?? null;
}


function asPositiveLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 75;
  return Math.min(Math.floor(parsed), 150);
}

function rowToInboxItem(row: InboxItem): ApiInboxItem {
  const rawDirection =
    row.raw_payload && typeof row.raw_payload === 'object' && !Array.isArray(row.raw_payload)
      ? (row.raw_payload as Record<string, unknown>).direction
      : null;
  return {
    id: `inbox:${row.id}`,
    source: row.source,
    direction: rawDirection === 'inbound' || rawDirection === 'outbound' ? rawDirection : null,
    title: row.title,
    preview: row.preview ?? null,
    body: row.body ?? null,
    fromLabel: row.from_label ?? null,
    fromEmail: row.from_email ?? null,
    fromPhone: row.from_phone ?? null,
    toLabel: row.to_label ?? null,
    toEmail: row.to_email ?? null,
    toPhone: row.to_phone ?? null,
    status: row.status,
    occurredAt: row.occurred_at,
    readAt: row.read_at ?? null,
    contactId: row.contact_id ?? null,
    href: row.contact_id ? `/leads/${row.contact_id}` : null,
  };
}

function normalizedPhoneKey(value: string | null | undefined): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  const e164 = normalizePhoneNumber(raw).e164;
  if (e164) return e164;
  const digits = raw.replace(/\D/g, '');
  if (digits) return `digits:${digits}`;
  return `raw:${raw.toLowerCase()}`;
}

function displayContactName(contact: ContactSummaryRow | null | undefined, fallbackPhone: string): string {
  const name = contact?.full_name?.trim();
  if (name && normalizedPhoneKey(name) !== normalizedPhoneKey(fallbackPhone)) return name;
  return fallbackPhone;
}

function smsConversationKey(
  row: DialerInboundMessageRow,
  phoneContactIds: Map<string, string>
): string {
  if (row.contact_id) return `contact:${row.contact_id}`;
  const phoneKey = normalizedPhoneKey(row.from_number_e164);
  const contactId = phoneKey ? phoneContactIds.get(phoneKey) : null;
  if (contactId) return `contact:${contactId}`;
  return phoneKey ? `phone:${phoneKey}` : `sms:${row.id}`;
}

function smsToInboxItem(
  row: DialerInboundMessageRow,
  contactsById: Map<string, ContactSummaryRow>,
  readAt: string | null = row.read_at
): ApiInboxItem {
  const contact = row.contact_id ? contactsById.get(row.contact_id) : null;
  const fromLabel = displayContactName(contact, row.from_number_e164);
  return {
    id: `sms:${row.id}`,
    source: 'sms',
    direction: 'inbound',
    title: fromLabel,
    preview: row.body,
    body: row.body,
    fromLabel,
    fromEmail: null,
    fromPhone: row.from_number_e164,
    toLabel: null,
    toEmail: null,
    toPhone: row.to_number_e164,
    status: 'open',
    occurredAt: row.received_at,
    readAt,
    contactId: row.contact_id,
    href: row.contact_id ? `/leads/${row.contact_id}` : null,
  };
}

function collapseSmsConversations(
  rows: DialerInboundMessageRow[],
  contactsById: Map<string, ContactSummaryRow>
): ApiInboxItem[] {
  const phoneContactIds = new Map<string, string>();
  for (const row of rows) {
    const phoneKey = normalizedPhoneKey(row.from_number_e164);
    if (phoneKey && row.contact_id && !phoneContactIds.has(phoneKey)) {
      phoneContactIds.set(phoneKey, row.contact_id);
    }
  }

  const groups = new Map<string, DialerInboundMessageRow[]>();
  for (const row of rows) {
    const key = smsConversationKey(row, phoneContactIds);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  return Array.from(groups.values()).map((group) => {
    const latest = group.reduce((current, candidate) =>
      new Date(candidate.received_at).getTime() > new Date(current.received_at).getTime()
        ? candidate
        : current
    );
    const contactId = latest.contact_id ?? group.find((row) => row.contact_id)?.contact_id ?? null;
    const readAt = group.every((row) => row.read_at) ? latest.read_at : null;
    return smsToInboxItem({ ...latest, contact_id: contactId }, contactsById, readAt);
  });
}

function notificationToInboxItem(row: NotificationRow): ApiInboxItem {
  const data = row.data ?? {};
  const source = String(data.source ?? row.type).includes('call')
    ? 'call'
    : String(data.source ?? row.type).includes('email')
      ? 'email'
      : String(data.source ?? row.type).includes('sms') || String(data.source ?? row.type).includes('text')
        ? 'sms'
        : 'system';
  const contactId = typeof data.contactId === 'string' ? data.contactId : null;
  return {
    id: `notification:${row.id}`,
    source,
    direction: null,
    title: row.title,
    preview: row.body,
    body: row.body,
    fromLabel: null,
    fromEmail: null,
    fromPhone: typeof data.from === 'string' ? data.from : null,
    toLabel: null,
    toEmail: null,
    toPhone: typeof data.to === 'string' ? data.to : null,
    status: 'open',
    occurredAt: row.created_at,
    readAt: row.read_at,
    contactId,
    href: contactId ? `/leads/${contactId}` : null,
  };
}

function notificationHasBackedInboxItem(row: NotificationRow): boolean {
  const data = row.data ?? {};
  return (
    row.type === 'dialer_inbound_sms' ||
    typeof data.inboundMessageId === 'string' ||
    typeof data.inboxItemId === 'string'
  );
}

function filterAndSort(items: ApiInboxItem[], sourceFilter: string, statusFilter: string, limit: number): ApiInboxItem[] {
  return items
    .filter((item) => COMMUNICATION_SOURCES.has(item.source))
    .filter((item) => sourceFilter === 'all' || item.source === sourceFilter)
    .filter((item) => statusFilter === 'all' || item.status === statusFilter)
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .slice(0, limit);
}

export async function GET(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const workspaceId = asUuid(request.nextUrl.searchParams.get('workspaceId'));
    if (!workspaceId) return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });

    const role = await getWorkspaceRole(workspaceId, requestUser.id);
    if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const limit = asPositiveLimit(request.nextUrl.searchParams.get('limit'));
    const sourceFilter = VALID_SOURCE_FILTERS.has(request.nextUrl.searchParams.get('source') ?? '')
      ? request.nextUrl.searchParams.get('source')!
      : 'all';
    const statusFilter = VALID_STATUS_FILTERS.has(request.nextUrl.searchParams.get('status') ?? '')
      ? request.nextUrl.searchParams.get('status')!
      : 'open';

    const admin = createAdminClient();
    const { data: salesperson, error: salespersonError } = await admin
      .from('salespeople')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', requestUser.id)
      .limit(1)
      .maybeSingle();

    if (salespersonError && salespersonError.code !== 'PGRST116') {
      return NextResponse.json({ error: salespersonError.message }, { status: 500 });
    }

    const salespersonId = typeof salesperson?.id === 'string' ? salesperson.id : null;
    const sourceIsSms = sourceFilter === 'all' || sourceFilter === 'sms';
    const inboundTextLimit = sourceIsSms ? Math.min(limit * 5, 500) : limit;
    let storedInboxQuery = admin
      .from('inbox_items')
      .select('*')
      .eq('workspace_id', workspaceId);
    if (salespersonId) {
      storedInboxQuery = storedInboxQuery.or(
        `salesperson_id.eq.${salespersonId},owner_user_id.eq.${requestUser.id}`
      );
    }

    let inboundTextsQuery = admin
      .from('dialer_inbound_messages')
      .select('id, contact_id, from_number_e164, to_number_e164, body, received_at, read_at')
      .eq('workspace_id', workspaceId);
    if (salespersonId) {
      inboundTextsQuery = inboundTextsQuery.eq('salesperson_id', salespersonId);
    }

    const [storedInbox, inboundTexts, notifications] = await Promise.all([
      storedInboxQuery
        .order('occurred_at', { ascending: false })
        .limit(limit),
      inboundTextsQuery
        .order('received_at', { ascending: false })
        .limit(inboundTextLimit),
      admin
        .from('notifications')
        .select('id, type, title, body, data, read_at, created_at')
        .eq('workspace_id', workspaceId)
        .eq('user_id', requestUser.id)
        .order('created_at', { ascending: false })
        .limit(limit),
    ]);

    for (const result of [storedInbox, inboundTexts, notifications]) {
      if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    }

    const inboundTextRows = (inboundTexts.data ?? []) as DialerInboundMessageRow[];
    const contactIds = Array.from(new Set(
      inboundTextRows
        .map((row) => row.contact_id)
        .filter((value): value is string => Boolean(value))
    ));
    let contactsById = new Map<string, ContactSummaryRow>();
    if (contactIds.length > 0) {
      const { data: contacts, error: contactsError } = await admin
        .from('contacts')
        .select('id, full_name, phone, phone_e164')
        .in('id', contactIds);

      if (contactsError) return NextResponse.json({ error: contactsError.message }, { status: 500 });
      contactsById = new Map(
        ((contacts ?? []) as ContactSummaryRow[]).map((contact) => [contact.id, contact])
      );
    }

    const items = filterAndSort(
      [
        ...((storedInbox.data ?? []) as InboxItem[]).map(rowToInboxItem),
        ...collapseSmsConversations(inboundTextRows, contactsById),
        ...((notifications.data ?? []) as NotificationRow[])
          .filter((row) => !notificationHasBackedInboxItem(row))
          .map(notificationToInboxItem),
      ],
      sourceFilter,
      statusFilter,
      limit
    );

    const counts = items.reduce<Record<string, number>>((acc, item) => {
      acc.all = (acc.all ?? 0) + 1;
      acc[item.source] = (acc[item.source] ?? 0) + 1;
      return acc;
    }, {});

    return NextResponse.json({ items, counts });
  } catch (error) {
    console.error('[api/inbox] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await request.json().catch(() => null)) as {
      workspaceId?: unknown;
      id?: unknown;
      status?: unknown;
      read?: unknown;
    } | null;

    const workspaceId = asUuid(body?.workspaceId);
    const compositeId = typeof body?.id === 'string' ? body.id : '';
    const [kind, rawId] = compositeId.split(':');
    const id = asUuid(rawId);
    const nextStatus =
      body?.status === 'done' || body?.status === 'open' || body?.status === 'archived'
        ? body.status
        : null;

    if (!workspaceId || !id || !kind) {
      return NextResponse.json({ error: 'workspaceId and id are required' }, { status: 400 });
    }

    const role = await getWorkspaceRole(workspaceId, requestUser.id);
    if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const admin = createAdminClient();
    const now = new Date().toISOString();

    if (kind === 'inbox') {
      const patch: Record<string, string | null> = {};
      if (body?.read === true) patch.read_at = now;
      if (nextStatus) {
        patch.status = nextStatus;
        patch.done_at = nextStatus === 'done' ? now : null;
      }
      const { error } = await admin.from('inbox_items').update(patch).eq('workspace_id', workspaceId).eq('id', id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (kind === 'sms') {
      const { data: message, error: messageError } = await admin
        .from('dialer_inbound_messages')
        .select('id, contact_id, from_number_e164')
        .eq('workspace_id', workspaceId)
        .eq('id', id)
        .maybeSingle();

      if (messageError) return NextResponse.json({ error: messageError.message }, { status: 500 });
      if (!message) return NextResponse.json({ error: 'Inbox item not found' }, { status: 404 });

      let updateQuery = admin
        .from('dialer_inbound_messages')
        .update({ read_at: now })
        .eq('workspace_id', workspaceId);

      const contactId = typeof message.contact_id === 'string' ? message.contact_id : null;
      const fromNumber = typeof message.from_number_e164 === 'string' ? message.from_number_e164 : null;
      if (contactId && fromNumber) {
        updateQuery = updateQuery.or(`contact_id.eq.${contactId},from_number_e164.eq.${fromNumber}`);
      } else if (contactId) {
        updateQuery = updateQuery.eq('contact_id', contactId);
      } else if (fromNumber) {
        updateQuery = updateQuery.eq('from_number_e164', fromNumber);
      } else {
        updateQuery = updateQuery.eq('id', id);
      }

      const { error } = await updateQuery;
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (kind === 'notification') {
      const { error } = await admin
        .from('notifications')
        .update({ read_at: now })
        .eq('workspace_id', workspaceId)
        .eq('user_id', requestUser.id)
        .eq('id', id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    if (kind === 'task' && nextStatus === 'done') {
      const { error } = await admin
        .from('calendar_events')
        .update({ deleted_at: now, updated_at: now })
        .eq('workspace_id', workspaceId)
        .eq('user_id', requestUser.id)
        .eq('id', id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unsupported inbox item type' }, { status: 400 });
  } catch (error) {
    console.error('[api/inbox] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await request.json().catch(() => null)) as {
      workspaceId?: unknown;
      channel?: unknown;
      contactId?: unknown;
      email?: unknown;
      subject?: unknown;
      body?: unknown;
    } | null;

    const workspaceId = asUuid(body?.workspaceId);
    const channel = cleanText(body?.channel).toLowerCase();
    const messageBody = cleanText(body?.body);
    const subject = cleanText(body?.subject) || 'Following up';
    const requestedContactId = asUuid(body?.contactId);
    const requestedEmail = normalizeEmail(body?.email);

    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId is required' }, { status: 400 });
    }
    if (channel !== 'email') {
      return NextResponse.json({ error: 'This endpoint currently accepts email replies.' }, { status: 400 });
    }
    if (!messageBody) {
      return NextResponse.json({ error: 'Write an email before sending it.' }, { status: 400 });
    }
    if (messageBody.length > MAX_EMAIL_BODY_LENGTH) {
      return NextResponse.json(
        { error: `Keep the email under ${MAX_EMAIL_BODY_LENGTH} characters.` },
        { status: 400 }
      );
    }
    if (subject.length > MAX_EMAIL_SUBJECT_LENGTH) {
      return NextResponse.json(
        { error: `Keep the subject under ${MAX_EMAIL_SUBJECT_LENGTH} characters.` },
        { status: 400 }
      );
    }

    const role = await getWorkspaceRole(workspaceId, requestUser.id);
    if (!role) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const admin = createAdminClient();
    let contact: InboxEmailContactRow | null = null;

    if (requestedContactId) {
      const { data, error } = await admin
        .from('contacts')
        .select('id, full_name, email')
        .eq('workspace_id', workspaceId)
        .eq('id', requestedContactId)
        .maybeSingle();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
      contact = data as InboxEmailContactRow;
    } else if (requestedEmail) {
      const { data, error } = await admin
        .from('contacts')
        .select('id, full_name, email')
        .eq('workspace_id', workspaceId)
        .ilike('email', requestedEmail)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error && error.code !== 'PGRST116') {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      contact = (data as InboxEmailContactRow | null) ?? null;
    }

    const recipient = requestedEmail ?? normalizeEmail(contact?.email);
    if (!recipient) {
      return NextResponse.json({ error: 'Add a valid recipient email address.' }, { status: 400 });
    }

    const apiKey = getEnv('RESEND_API_KEY');
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Email is not configured. Set RESEND_API_KEY.' },
        { status: 503 }
      );
    }

    const salesperson = await resolveSalespersonEmailRoute(admin, workspaceId, requestUser);
    if (!salesperson) {
      return NextResponse.json(
        { error: 'Your salesperson email route is not configured.' },
        { status: 409 }
      );
    }

    const handle = await resolveAvailableDemoEmailHandle(
      admin as unknown as HandleLookupClient,
      salesperson,
      requestUser.email
    );
    if (!cleanText(salesperson.demo_email_handle)) {
      const { error } = await admin
        .from('salespeople')
        .update({ demo_email_handle: handle })
        .eq('id', salesperson.id)
        .is('demo_email_handle', null);
      if (error) {
        console.warn('[api/inbox] failed to store salesperson email handle', error);
      }
    }

    const fromLabel = safeSenderName(salesperson.full_name, requestUser.email);
    const fromEmail = `${handle}@${getEnv('RESEND_INBOUND_DOMAIN') || DEMO_EMAIL_DOMAIN}`;
    const resend = new Resend(apiKey);
    const escapedBody = escapeHtml(messageBody).replace(/\n/g, '<br />');
    const { data, error: sendError } = await resend.emails.send({
      from: `${fromLabel} <${fromEmail}>`,
      to: recipient,
      subject,
      text: messageBody,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.6;color:#111827;">${escapedBody}</div>`,
    });

    if (sendError) {
      return NextResponse.json(
        { error: sendError.message?.trim() || 'Failed to send the email.' },
        { status: sendError.statusCode ?? 500 }
      );
    }

    const now = new Date().toISOString();
    const emailId = typeof data?.id === 'string' ? data.id : null;
    const inboxPayload = {
      workspace_id: workspaceId,
      owner_user_id: requestUser.id,
      salesperson_id: salesperson.id,
      contact_id: contact?.id ?? null,
      source: 'email',
      source_table: 'resend_sent_emails',
      source_id: emailId,
      external_id: emailId,
      title: subject,
      preview: messageBody.replace(/\s+/g, ' ').slice(0, 280),
      body: messageBody,
      from_label: fromLabel,
      from_email: fromEmail,
      to_label: cleanText(contact?.full_name) || null,
      to_email: recipient,
      status: 'open',
      priority: 'normal',
      occurred_at: now,
      read_at: now,
      raw_payload: {
        direction: 'outbound',
        provider: 'resend',
        providerMessageId: emailId,
      },
    };

    const { error: inboxError } = await admin.from('inbox_items').insert(inboxPayload);
    const warning = inboxError
      ? 'Email sent, but WolfGrid could not save it to the conversation.'
      : null;
    if (inboxError) {
      console.warn('[api/inbox] failed to save outbound email', inboxError);
    }

    if (contact?.id) {
      const [activityResult, contactResult] = await Promise.all([
        admin.from('contact_activities').insert({
          contact_id: contact.id,
          type: 'email',
          note: `Outbound email: ${subject}\n${messageBody}`,
          timestamp: now,
        }),
        admin
          .from('contacts')
          .update({ last_contacted: now, updated_at: now })
          .eq('workspace_id', workspaceId)
          .eq('id', contact.id),
      ]);
      if (activityResult.error) {
        console.warn('[api/inbox] failed to log outbound email activity', activityResult.error);
      }
      if (contactResult.error) {
        console.warn('[api/inbox] failed to update emailed contact', contactResult.error);
      }
    }

    return NextResponse.json({ sent: true, emailId, warning }, { status: 201 });
  } catch (error) {
    console.error('[api/inbox] POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
