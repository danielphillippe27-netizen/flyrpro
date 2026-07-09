import { NextRequest, NextResponse } from 'next/server';
import { validateTwilioWebhookRequest } from '@/lib/dialer/server';
import { createAdminClient } from '@/lib/supabase/server';
import { normalizePhoneNumber } from '@/lib/dialer/phone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MISSED_STATUSES = new Set(['no-answer', 'busy', 'failed', 'canceled']);

type InboundCallRoute = {
  workspaceId: string;
  salespersonId: string | null;
  salespersonUserId: string | null;
};

async function resolveInboundCallRoute(
  admin: ReturnType<typeof createAdminClient>,
  calledNumber: string | null
): Promise<InboundCallRoute | null> {
  if (!calledNumber) return null;

  const { data: salespersonNumber, error: salespersonNumberError } = await admin
    .from('salesperson_dialer_settings')
    .select('workspace_id, salesperson_id')
    .or(`assigned_phone_number.eq.${calledNumber},default_sms_from_number.eq.${calledNumber}`)
    .eq('number_status', 'active')
    .limit(1)
    .maybeSingle();

  if (salespersonNumberError && salespersonNumberError.code !== 'PGRST116') {
    console.warn('[twilio/incoming-status] salesperson number lookup failed', salespersonNumberError);
  }

  if (salespersonNumber?.workspace_id) {
    const salespersonId =
      typeof salespersonNumber.salesperson_id === 'string'
        ? salespersonNumber.salesperson_id
        : null;
    let salespersonUserId: string | null = null;

    if (salespersonId) {
      const { data: salesperson, error: salespersonError } = await admin
        .from('salespeople')
        .select('user_id')
        .eq('id', salespersonId)
        .maybeSingle();

      if (salespersonError && salespersonError.code !== 'PGRST116') {
        console.warn('[twilio/incoming-status] salesperson user lookup failed', salespersonError);
      }

      salespersonUserId = typeof salesperson?.user_id === 'string' ? salesperson.user_id : null;
    }

    return {
      workspaceId: salespersonNumber.workspace_id as string,
      salespersonId,
      salespersonUserId,
    };
  }

  const { data, error } = await admin
    .from('workspace_dialer_settings')
    .select('workspace_id')
    .or(`default_from_number.eq.${calledNumber},default_sms_from_number.eq.${calledNumber}`)
    .limit(1)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.warn('[twilio/incoming-status] workspace lookup failed', error);
  }

  return typeof data?.workspace_id === 'string'
    ? { workspaceId: data.workspace_id, salespersonId: null, salespersonUserId: null }
    : null;
}

async function findContactByPhone(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  callerNumber: string | null
): Promise<Record<string, unknown> | null> {
  if (!callerNumber) return null;
  const { data, error } = await admin
    .from('contacts')
    .select('id, full_name, phone, phone_e164')
    .eq('workspace_id', workspaceId)
    .or(`phone_e164.eq.${callerNumber},phone.eq.${callerNumber}`)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.warn('[twilio/incoming-status] contact lookup failed', error);
  }

  return (data as Record<string, unknown> | null) ?? null;
}

async function resolveInboundLeadOwner(params: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
  salespersonUserId: string | null;
}): Promise<string | null> {
  if (params.salespersonUserId) return params.salespersonUserId;

  const { data: ownerMember } = await params.admin
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', params.workspaceId)
    .in('role', ['owner', 'admin'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  return typeof ownerMember?.user_id === 'string' ? ownerMember.user_id : null;
}

async function findOrCreateSalesLeadByPhone(params: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
  salespersonId: string | null;
  salespersonUserId: string | null;
  callerNumber: string | null;
}): Promise<Record<string, unknown> | null> {
  if (!params.callerNumber) return null;

  const now = new Date().toISOString();
  const { data: existing, error } = await params.admin
    .from('sales_leads')
    .select('*')
    .eq('workspace_id', params.workspaceId)
    .or(`phone_e164.eq.${params.callerNumber},phone.eq.${params.callerNumber}`)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.warn('[twilio/incoming-status] sales lead lookup failed', error);
  }

  if (existing) return existing as Record<string, unknown>;

  const assignedUserId = await resolveInboundLeadOwner(params);
  if (!assignedUserId) return null;

  const { data: created, error: createError } = await params.admin
    .from('sales_leads')
    .insert({
      workspace_id: params.workspaceId,
      user_id: assignedUserId,
      assigned_user_id: assignedUserId,
      assigned_salesperson_id: params.salespersonId,
      created_by_user_id: assignedUserId,
      name: params.callerNumber,
      phone: params.callerNumber,
      phone_e164: params.callerNumber,
      source: 'salesperson_inbound_call',
      lead_state: 'callback',
      next_follow_up_at: now,
      last_touch_at: now,
      last_touch_summary: 'Missed inbound call',
      metadata: { inboundProvider: 'twilio' },
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();

  if (createError) {
    console.warn('[twilio/incoming-status] sales lead create failed', createError);
    return null;
  }

  return created as Record<string, unknown>;
}

async function notifyWorkspaceMembers(context: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
  salespersonUserId: string | null;
  inboxItemId: string;
  callerNumber: string | null;
  contactId: string | null;
  salesLeadId: string | null;
}) {
  let recipientUserIds = context.salespersonUserId ? [context.salespersonUserId] : [];

  if (recipientUserIds.length === 0) {
    const { data: members, error } = await context.admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', context.workspaceId);

    if (error || !members?.length) {
      if (error) console.warn('[twilio/incoming-status] workspace member lookup failed', error);
      return;
    }

    recipientUserIds = (members ?? [])
      .map((member) => (typeof member.user_id === 'string' ? member.user_id : null))
      .filter((userId): userId is string => Boolean(userId));
  }

  if (recipientUserIds.length === 0) {
    return;
  }

  const rows = Array.from(new Set(recipientUserIds)).map((userId) => ({
    workspace_id: context.workspaceId,
    user_id: userId,
    type: 'inbox_missed_call',
    title: 'Missed inbound call',
    body: context.callerNumber ? `Missed call from ${context.callerNumber}` : 'Missed inbound call',
    data: {
      inboxItemId: context.inboxItemId,
      source: 'call',
      from: context.callerNumber,
      contactId: context.contactId,
      salesLeadId: context.salesLeadId,
    },
    read_at: null,
  }));

  if (rows.length === 0) return;
  const { error: notificationError } = await context.admin.from('notifications').insert(rows);
  if (notificationError) console.warn('[twilio/incoming-status] notification create failed', notificationError);
}

export async function POST(request: NextRequest) {
  const validation = await validateTwilioWebhookRequest(request);
  if (!validation.isValid) {
    return validation.response!;
  }

  const callerNumber = normalizePhoneNumber(validation.params.From ?? validation.params.Caller).e164;
  const calledNumber = normalizePhoneNumber(validation.params.To ?? validation.params.Called).e164;
  const dialCallStatus = validation.params.DialCallStatus ?? validation.params.CallStatus ?? '';
  const callSid = validation.params.CallSid ?? validation.params.ParentCallSid ?? null;

  if (!MISSED_STATUSES.has(dialCallStatus)) {
    return NextResponse.json({ ok: true });
  }

  const admin = createAdminClient();
  const inboundRoute = await resolveInboundCallRoute(admin, calledNumber);
  if (!inboundRoute?.workspaceId) {
    console.warn('[twilio/incoming-status] no workspace matched missed call', { calledNumber });
    return NextResponse.json({ ok: true });
  }
  const { workspaceId, salespersonId, salespersonUserId } = inboundRoute;

  const isSalespersonInbound = Boolean(salespersonId || salespersonUserId);
  const salesLead = isSalespersonInbound
    ? await findOrCreateSalesLeadByPhone({ admin, workspaceId, salespersonId, salespersonUserId, callerNumber })
    : null;
  const contact = isSalespersonInbound ? null : await findContactByPhone(admin, workspaceId, callerNumber);
  const salesLeadId = typeof salesLead?.id === 'string' ? salesLead.id : null;
  const contactId = typeof contact?.id === 'string' ? contact.id : null;
  const now = new Date().toISOString();
  const displayName = typeof salesLead?.name === 'string'
    ? salesLead.name
    : typeof contact?.full_name === 'string'
      ? contact.full_name
      : null;
  const title = displayName
    ? `Missed call from ${displayName}`
    : callerNumber
      ? `Missed call from ${callerNumber}`
      : 'Missed inbound call';

  const { data: inboxItem, error: inboxError } = await admin
    .from('inbox_items')
    .upsert({
      workspace_id: workspaceId,
      salesperson_id: salespersonId,
      contact_id: contactId,
      sales_lead_id: salesLeadId,
      source: 'call',
      source_table: 'twilio_incoming_calls',
      source_id: callSid,
      external_id: callSid,
      title,
      preview: callerNumber ? `Call back ${callerNumber}` : 'Call back this lead',
      from_label: displayName ?? callerNumber,
      from_phone: callerNumber,
      to_phone: calledNumber,
      status: 'open',
      priority: 'high',
      occurred_at: now,
      raw_payload: validation.params,
    }, { onConflict: 'workspace_id,source,source_table,source_id' })
    .select('id')
    .single();

  if (inboxError) {
    console.error('[twilio/incoming-status] failed to save missed call inbox item', inboxError);
    return NextResponse.json({ ok: true });
  }

  await notifyWorkspaceMembers({
    admin,
    workspaceId,
    salespersonUserId,
    inboxItemId: String(inboxItem.id),
    callerNumber,
    contactId,
    salesLeadId,
  });

  return NextResponse.json({ ok: true });
}
