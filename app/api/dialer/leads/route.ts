import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  resolveWorkspaceMembershipForUser,
  type MinimalSupabaseClient,
} from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';
import { isDialerFounderBypassEmail } from '@/lib/dialer/feature-gate';
import { getTwilioAccountSid, getTwilioAuthToken, getTwilioDefaultSmsFromNumber } from '@/lib/dialer/env';
import { normalizePhoneNumber } from '@/lib/dialer/phone';
import { buildPublicTwilioWebhookUrl } from '@/lib/dialer/server';
import type { DiallerLead, DiallerLeadDisposition } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ImportLeadPayload = {
  workspaceId?: string;
  leads?: Array<{
    name?: string | null;
    phone?: string | null;
    company?: string | null;
    email?: string | null;
  }>;
};

type UpdateLeadPayload = {
  workspaceId?: string;
  id?: string;
  disposition?: DiallerLeadDisposition | null;
  notes?: string | null;
  email?: string | null;
  sendLink?: boolean;
  followUpName?: string | null;
  followUpAt?: string | null;
  createNotification?: boolean;
  saveContact?: boolean;
};

const VALID_DISPOSITIONS = new Set<DiallerLeadDisposition>([
  'interested',
  'callback',
  'not_now',
  'dnc',
]);

async function resolveDiallerContext(request: NextRequest, workspaceId?: string | null) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const membership = await resolveWorkspaceMembershipForUser(
    admin as unknown as MinimalSupabaseClient,
    requestUser.id,
    workspaceId
  );

  if (!membership.workspaceId) {
    if (workspaceId && isDialerFounderBypassEmail(requestUser.email)) {
      const { data: workspace } = await admin
        .from('workspaces')
        .select('id')
        .eq('id', workspaceId)
        .maybeSingle();

      if (workspace?.id) {
        return {
          admin,
          workspaceId: workspace.id as string,
          requestUser,
        };
      }
    }

    return NextResponse.json(
      { error: membership.error ?? 'Workspace not found' },
      { status: membership.status ?? 403 }
    );
  }

  return {
    admin,
    workspaceId: membership.workspaceId,
    requestUser,
  };
}

function cleanText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function getAppLink(request: NextRequest): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_BASE_URL?.trim() ||
    request.nextUrl.origin
  ).replace(/\/$/, '');
}

function buildInterestedLinkText(lead: DiallerLead, linkUrl: string): string {
  const firstName = lead.name.trim().split(/\s+/)[0];
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,';
  return `${greeting} here is the FLYR link: ${linkUrl}`;
}

async function sendInterestedLink(request: NextRequest, lead: DiallerLead): Promise<string | null> {
  const from = getTwilioDefaultSmsFromNumber();
  if (!from) return 'Lead saved, but no SMS-enabled Twilio number is configured.';

  const normalizedPhone = normalizePhoneNumber(lead.phone);
  if (!normalizedPhone.e164) return 'Lead saved, but the phone number is not valid for SMS.';

  const client = twilio(getTwilioAccountSid(), getTwilioAuthToken());
  const statusCallback = buildPublicTwilioWebhookUrl(request, '/api/twilio/messaging/status');
  await client.messages.create({
    from,
    to: normalizedPhone.e164,
    body: buildInterestedLinkText(lead, getAppLink(request)),
    statusCallback: statusCallback.toString(),
  });

  return null;
}

function cleanIsoDate(value: string | null | undefined): string | null {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  const date = new Date(cleaned);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function findExistingContact(context: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
}, lead: DiallerLead): Promise<Record<string, unknown> | null> {
  const normalizedPhone = normalizePhoneNumber(lead.phone);
  const lookups = [
    normalizedPhone.e164 ? { column: 'phone_e164', value: normalizedPhone.e164 } : null,
    cleanText(lead.phone) ? { column: 'phone', value: cleanText(lead.phone) } : null,
    cleanText(lead.email) ? { column: 'email', value: cleanText(lead.email) } : null,
  ].filter((lookup): lookup is { column: string; value: string } => Boolean(lookup));

  for (const lookup of lookups) {
    const { data, error } = await context.admin
      .from('contacts')
      .select('*')
      .eq('workspace_id', context.workspaceId)
      .eq(lookup.column, lookup.value)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) return data as Record<string, unknown>;
    if (error && error.code !== 'PGRST116') {
      console.warn('[dialer/leads] contact lookup failed', error);
    }
  }

  return null;
}

async function syncContactFollowUpCalendarEvent(context: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
  requestUser: { id: string };
}, contact: Record<string, unknown>, followUpAt: string | null, notes: string | null): Promise<void> {
  const contactId = typeof contact.id === 'string' ? contact.id : null;
  if (!contactId || !followUpAt) return;

  const startAt = new Date(followUpAt);
  if (Number.isNaN(startAt.getTime())) return;
  const endAt = new Date(startAt.getTime() + 30 * 60 * 1000);
  const fullName = typeof contact.full_name === 'string' && contact.full_name.trim() ? contact.full_name.trim() : 'Lead';
  const address = typeof contact.address === 'string' ? contact.address : '';
  const now = new Date().toISOString();
  const eventPayload = {
    user_id: context.requestUser.id,
    workspace_id: context.workspaceId,
    title: `Follow up: ${fullName}`,
    start_at: startAt.toISOString(),
    end_at: endAt.toISOString(),
    is_all_day: false,
    event_type: 'follow_up',
    contact_id: contactId,
    contact_name: fullName,
    contact_address: address,
    source_kind: 'contact_follow_up',
    source_id: contactId,
    notes,
    location: address || null,
    color_key: 'blue',
    deleted_at: null,
    updated_at: now,
  };

  const { data: existingEvent, error: lookupError } = await context.admin
    .from('calendar_events')
    .select('id')
    .eq('source_kind', 'contact_follow_up')
    .eq('source_id', contactId)
    .eq('event_type', 'follow_up')
    .maybeSingle();

  if (lookupError && lookupError.code !== 'PGRST116') {
    console.warn('[dialer/leads] calendar follow-up lookup failed', lookupError);
    return;
  }

  const result = existingEvent?.id
    ? await context.admin.from('calendar_events').update(eventPayload).eq('id', existingEvent.id)
    : await context.admin.from('calendar_events').insert({ ...eventPayload, created_at: now });

  if (result.error) {
    console.warn('[dialer/leads] calendar follow-up sync failed', result.error);
  }
}

async function upsertContactFollowUp(context: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
  requestUser: { id: string };
}, lead: DiallerLead, followUpAt: string | null, notes: string | null): Promise<string | null> {
  if (!followUpAt) return null;

  const normalizedPhone = normalizePhoneNumber(lead.phone);
  const existing = await findExistingContact(context, lead);
  const now = new Date().toISOString();
  const contactPayload = {
    user_id: context.requestUser.id,
    workspace_id: context.workspaceId,
    full_name: cleanText(lead.name) || 'Lead',
    phone: cleanText(lead.phone) || null,
    phone_e164: normalizedPhone.e164,
    email: cleanText(lead.email) || null,
    address: '',
    status: 'warm',
    notes,
    follow_up_at: followUpAt,
    reminder_date: followUpAt,
    last_contacted: now,
    updated_at: now,
  };

  const { data, error } = existing?.id
    ? await context.admin
        .from('contacts')
        .update(contactPayload)
        .eq('id', existing.id)
        .select('*')
        .single()
    : await context.admin
        .from('contacts')
        .insert({ ...contactPayload, created_at: now })
        .select('*')
        .single();

  if (error) {
    console.error('[dialer/leads] failed to upsert contact follow-up', error);
    return 'Callback saved, but it could not be added to Follow Up tasks.';
  }

  await syncContactFollowUpCalendarEvent(context, data as Record<string, unknown>, followUpAt, notes);
  return null;
}

async function upsertDiallerContact(context: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
  requestUser: { id: string };
}, lead: DiallerLead, notes: string | null): Promise<{ contact: Record<string, unknown> | null; warning: string | null }> {
  const normalizedPhone = normalizePhoneNumber(lead.phone);
  const existing = await findExistingContact(context, lead);
  const now = new Date().toISOString();
  const contactPayload = {
    user_id: context.requestUser.id,
    workspace_id: context.workspaceId,
    full_name: cleanText(lead.name) || 'Lead',
    phone: cleanText(lead.phone) || null,
    phone_e164: normalizedPhone.e164,
    phone_last_validated_at: now,
    phone_validation_error: normalizedPhone.error,
    email: cleanText(lead.email) || null,
    address: '',
    status: 'warm',
    notes,
    last_contacted: now,
    updated_at: now,
  };

  const { data, error } = existing?.id
    ? await context.admin
        .from('contacts')
        .update(contactPayload)
        .eq('id', existing.id)
        .select('*')
        .single()
    : await context.admin
        .from('contacts')
        .insert({ ...contactPayload, created_at: now })
        .select('*')
        .single();

  if (error) {
    console.error('[dialer/leads] failed to save dialler contact', error);
    return { contact: null, warning: 'Lead saved, but it could not be saved to Contacts.' };
  }

  return { contact: data as Record<string, unknown>, warning: null };
}

async function createFollowUpNotification(context: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
  requestUser: { id: string };
}, lead: DiallerLead, followUpName: string | null, followUpAt: string | null): Promise<string | null> {
  const title = followUpName || `Follow up with ${lead.name || 'lead'}`;
  const dueText = followUpAt ? new Date(followUpAt).toLocaleString() : 'soon';
  const { error } = await context.admin.from('notifications').insert({
    workspace_id: context.workspaceId,
    user_id: context.requestUser.id,
    type: 'dialler_follow_up',
    title,
    body: `Callback task for ${lead.name || 'lead'} due ${dueText}.`,
    data: {
      diallerLeadId: lead.id,
      phone: lead.phone,
      company: lead.company,
      email: lead.email,
      followUpAt,
    },
    read_at: null,
  });

  if (!error) return null;
  console.warn('[dialer/leads] failed to create follow-up notification', error);
  return 'Callback saved, but the notification could not be created.';
}

function shapeMissingTableError(error: { message?: string; code?: string } | null | undefined) {
  if (!error) return null;
  if (error.code === '42P01' || error.message?.toLowerCase().includes('dialler_leads')) {
    return 'dialler_leads is not ready yet. Run the latest Supabase migration.';
  }
  return null;
}

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get('workspaceId');
  const context = await resolveDiallerContext(request, workspaceId);
  if (context instanceof NextResponse) return context;

  const { data, error } = await context.admin
    .from('dialler_leads')
    .select('*')
    .eq('workspace_id', context.workspaceId)
    .order('created_at', { ascending: true });

  if (error) {
    const tableError = shapeMissingTableError(error);
    console.error('[dialer/leads] failed to load dialler leads', error);
    return NextResponse.json({ error: tableError ?? 'Failed to load dialler leads' }, { status: 500 });
  }

  return NextResponse.json({ leads: (data ?? []) as DiallerLead[] });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as ImportLeadPayload;
  const context = await resolveDiallerContext(request, body.workspaceId);
  if (context instanceof NextResponse) return context;

  const rows = Array.isArray(body.leads) ? body.leads : [];
  const inserts = rows
    .flatMap((row) => {
      const phone = cleanText(row.phone);
      if (!normalizePhoneNumber(phone).isValid) return [];
      return [{
        workspace_id: context.workspaceId,
        name: cleanText(row.name) || 'Lead',
        phone,
        company: cleanText(row.company) || null,
        email: cleanText(row.email) || null,
        disposition: null,
        notes: null,
        called_at: null,
      }];
    });

  if (inserts.length === 0) {
    return NextResponse.json({ error: 'Import a CSV with at least one phone number.' }, { status: 400 });
  }

  const { data, error } = await context.admin
    .from('dialler_leads')
    .insert(inserts)
    .select('*');

  if (error) {
    const tableError = shapeMissingTableError(error);
    console.error('[dialer/leads] failed to import dialler leads', error);
    return NextResponse.json({ error: tableError ?? 'Failed to import dialler leads' }, { status: 500 });
  }

  return NextResponse.json({ leads: (data ?? []) as DiallerLead[], importedCount: data?.length ?? inserts.length }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as UpdateLeadPayload;
  const context = await resolveDiallerContext(request, body.workspaceId);
  if (context instanceof NextResponse) return context;

  if (!body.id) {
    return NextResponse.json({ error: 'Lead id is required.' }, { status: 400 });
  }

  if (body.saveContact) {
    const { data: existingLead, error: existingLeadError } = await context.admin
      .from('dialler_leads')
      .select('*')
      .eq('id', body.id)
      .eq('workspace_id', context.workspaceId)
      .maybeSingle();

    if (existingLeadError) {
      const tableError = shapeMissingTableError(existingLeadError);
      console.error('[dialer/leads] failed to load dialler lead for contact save', existingLeadError);
      return NextResponse.json({ error: tableError ?? 'Failed to load dialler lead' }, { status: 500 });
    }

    if (!existingLead) {
      return NextResponse.json({ error: 'Lead not found.' }, { status: 404 });
    }

    const { data, error } = await context.admin
      .from('dialler_leads')
      .update({
        notes: cleanText(body.notes) || null,
        email: cleanText(body.email) || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.id)
      .eq('workspace_id', context.workspaceId)
      .select('*')
      .single();

    if (error) {
      const tableError = shapeMissingTableError(error);
      console.error('[dialer/leads] failed to save dialler lead contact fields', error);
      return NextResponse.json({ error: tableError ?? 'Failed to save contact' }, { status: 500 });
    }

    const contactSave = await upsertDiallerContact(
      context,
      data as DiallerLead,
      cleanText(body.notes) || null
    );

    return NextResponse.json({
      lead: data as DiallerLead,
      contact: contactSave.contact,
      warning: contactSave.warning,
    });
  }

  if (!body.disposition || !VALID_DISPOSITIONS.has(body.disposition)) {
    return NextResponse.json({ error: 'Choose a valid disposition.' }, { status: 400 });
  }

  const { data, error } = await context.admin
    .from('dialler_leads')
    .update({
      disposition: body.disposition,
      notes: cleanText(body.notes) || null,
      email: cleanText(body.email) || null,
      follow_up_name: cleanText(body.followUpName) || null,
      follow_up_at: cleanIsoDate(body.followUpAt),
      called_at: new Date().toISOString(),
    })
    .eq('id', body.id)
    .eq('workspace_id', context.workspaceId)
    .select('*')
    .single();

  if (error) {
    const tableError = shapeMissingTableError(error);
    console.error('[dialer/leads] failed to save dialler lead', error);
    return NextResponse.json({ error: tableError ?? 'Failed to save dialler lead' }, { status: 500 });
  }

  let warning: string | null = null;
  if (body.sendLink) {
    try {
      warning = await sendInterestedLink(request, data as DiallerLead);
    } catch (sendError) {
      console.error('[dialer/leads] failed to send interested link', sendError);
      warning = sendError instanceof Error ? sendError.message : 'Lead saved, but the link text could not be sent.';
    }
  }

  if (body.createNotification) {
    const followUpAt = cleanIsoDate(body.followUpAt);
    const contactWarning = await upsertContactFollowUp(
      context,
      data as DiallerLead,
      followUpAt,
      cleanText(body.notes) || null
    );
    const notificationWarning = await createFollowUpNotification(
      context,
      data as DiallerLead,
      cleanText(body.followUpName) || null,
      followUpAt
    );
    warning = warning ?? contactWarning ?? notificationWarning;
  }

  return NextResponse.json({ lead: data as DiallerLead, warning });
}

export async function DELETE(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { workspaceId?: string; id?: string; deleteAll?: boolean };
  const context = await resolveDiallerContext(request, body.workspaceId);
  if (context instanceof NextResponse) return context;

  if (body.deleteAll) {
    const { data, error } = await context.admin
      .from('dialler_leads')
      .delete()
      .eq('workspace_id', context.workspaceId)
      .select('id');

    if (error) {
      const tableError = shapeMissingTableError(error);
      console.error('[dialer/leads] failed to delete dialler lead list', error);
      return NextResponse.json({ error: tableError ?? 'Failed to delete dialler lead list' }, { status: 500 });
    }

    return NextResponse.json({ deletedCount: data?.length ?? 0 });
  }

  if (!body.id) {
    return NextResponse.json({ error: 'Lead id is required.' }, { status: 400 });
  }

  const { error } = await context.admin
    .from('dialler_leads')
    .delete()
    .eq('id', body.id)
    .eq('workspace_id', context.workspaceId);

  if (error) {
    const tableError = shapeMissingTableError(error);
    console.error('[dialer/leads] failed to delete dialler lead', error);
    return NextResponse.json({ error: tableError ?? 'Failed to delete dialler lead' }, { status: 500 });
  }

  return NextResponse.json({ deletedId: body.id });
}
