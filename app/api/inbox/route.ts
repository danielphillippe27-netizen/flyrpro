import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { asUuid, getWorkspaceRole } from '@/app/api/routes/_lib';
import { createAdminClient } from '@/lib/supabase/server';
import type { InboxItem, InboxItemSource, InboxItemStatus } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ApiInboxItem = {
  id: string;
  source: InboxItemSource;
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

type NotificationRow = {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

const COMMUNICATION_SOURCES = new Set<InboxItemSource>(['email', 'sms', 'call']);
const VALID_SOURCE_FILTERS = new Set(['all', 'email', 'sms', 'call']);
const VALID_STATUS_FILTERS = new Set(['open', 'done', 'snoozed', 'archived', 'all']);

function asPositiveLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 75;
  return Math.min(Math.floor(parsed), 150);
}

function rowToInboxItem(row: InboxItem): ApiInboxItem {
  return {
    id: `inbox:${row.id}`,
    source: row.source,
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

function smsToInboxItem(row: DialerInboundMessageRow): ApiInboxItem {
  return {
    id: `sms:${row.id}`,
    source: 'sms',
    title: 'Inbound text',
    preview: row.body,
    body: row.body,
    fromLabel: row.from_number_e164,
    fromEmail: null,
    fromPhone: row.from_number_e164,
    toLabel: null,
    toEmail: null,
    toPhone: row.to_number_e164,
    status: 'open',
    occurredAt: row.received_at,
    readAt: row.read_at,
    contactId: row.contact_id,
    href: row.contact_id ? `/leads/${row.contact_id}` : null,
  };
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
        .limit(limit),
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

    const items = filterAndSort(
      [
        ...((storedInbox.data ?? []) as InboxItem[]).map(rowToInboxItem),
        ...((inboundTexts.data ?? []) as DialerInboundMessageRow[]).map(smsToInboxItem),
        ...((notifications.data ?? []) as NotificationRow[]).map(notificationToInboxItem),
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
      const { error } = await admin
        .from('dialer_inbound_messages')
        .update({ read_at: now })
        .eq('workspace_id', workspaceId)
        .eq('id', id);
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
