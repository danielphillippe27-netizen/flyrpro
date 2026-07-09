import { NextRequest, NextResponse } from 'next/server';
import type { DialerInboundMessage } from '@/types/database';
import { createAdminClient } from '@/lib/supabase/server';
import { getDialerEnabledWorkspaceIds } from '@/lib/dialer/feature-gate';
import { getTelnyxDefaultFromNumber, getTelnyxDefaultSmsFromNumber } from '@/lib/dialer/env';
import { normalizePhoneNumber } from '@/lib/dialer/phone';
import { validateTelnyxWebhookRequest } from '@/lib/dialer/telnyx';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type InboundNumberRoute = {
  workspaceId: string;
  salespersonId: string | null;
  salespersonUserId: string | null;
};

function getPayload(body: Record<string, unknown>) {
  const data = body.data && typeof body.data === 'object' ? body.data as Record<string, unknown> : body;
  const payload = data.payload && typeof data.payload === 'object' ? data.payload as Record<string, unknown> : data;
  return {
    eventType: typeof data.event_type === 'string' ? data.event_type : null,
    payload,
  };
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getPhone(value: unknown): string | null {
  if (typeof value === 'string') return normalizePhoneNumber(value).e164;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const phone = record.phone_number ?? record.number ?? record.address;
    return typeof phone === 'string' ? normalizePhoneNumber(phone).e164 : null;
  }
  return null;
}

function getToPhone(value: unknown): string | null {
  if (Array.isArray(value)) return getPhone(value[0]);
  return getPhone(value);
}

function getFallbackWorkspaceId(): string | null {
  const enabledWorkspaceIds = getDialerEnabledWorkspaceIds();
  return enabledWorkspaceIds.length === 1 ? enabledWorkspaceIds[0] : null;
}

async function resolveInboundNumberRoute(
  admin: ReturnType<typeof createAdminClient>,
  toNumber: string
): Promise<InboundNumberRoute | null> {
  const { data: salespersonNumber, error: salespersonNumberError } = await admin
    .from('salesperson_dialer_settings')
    .select('workspace_id, salesperson_id')
    .or(`default_sms_from_number.eq.${toNumber},assigned_phone_number.eq.${toNumber}`)
    .eq('number_status', 'active')
    .limit(1)
    .maybeSingle();

  if (salespersonNumberError && salespersonNumberError.code !== 'PGRST116') {
    console.warn('[telnyx/messaging/incoming] salesperson number lookup failed', salespersonNumberError);
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
        console.warn('[telnyx/messaging/incoming] salesperson user lookup failed', salespersonError);
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
    .or(`default_sms_from_number.eq.${toNumber},default_from_number.eq.${toNumber}`)
    .limit(1)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.warn('[telnyx/messaging/incoming] workspace lookup failed', error);
  }

  if (data?.workspace_id) {
    return { workspaceId: data.workspace_id as string, salespersonId: null, salespersonUserId: null };
  }

  const sharedSmsNumber = getTelnyxDefaultSmsFromNumber();
  const sharedVoiceNumber = getTelnyxDefaultFromNumber();
  if (toNumber === sharedSmsNumber || toNumber === sharedVoiceNumber) {
    const workspaceId = getFallbackWorkspaceId();
    return workspaceId ? { workspaceId, salespersonId: null, salespersonUserId: null } : null;
  }

  return null;
}

async function findOrCreateContact(context: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
}, fromNumber: string, body: string): Promise<Record<string, unknown> | null> {
  const { data: existing } = await context.admin
    .from('contacts')
    .select('*')
    .eq('workspace_id', context.workspaceId)
    .eq('phone_e164', fromNumber)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const now = new Date().toISOString();
  if (existing) {
    const { data: updated } = await context.admin
      .from('contacts')
      .update({
        phone_e164: fromNumber,
        phone_last_validated_at: now,
        phone_validation_error: null,
        last_contacted: now,
        updated_at: now,
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    return (updated ?? existing) as Record<string, unknown>;
  }

  const { data: ownerMember } = await context.admin
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', context.workspaceId)
    .in('role', ['owner', 'admin'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  const fallbackUserId = typeof ownerMember?.user_id === 'string' ? ownerMember.user_id : null;
  if (!fallbackUserId) return null;

  const { data: created, error: createError } = await context.admin
    .from('contacts')
    .insert({
      workspace_id: context.workspaceId,
      user_id: fallbackUserId,
      full_name: fromNumber,
      phone: fromNumber,
      phone_e164: fromNumber,
      address: '',
      status: 'warm',
      source: 'dialer_inbound_sms',
      notes: `Inbound SMS: ${body}`,
      last_contacted: now,
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();

  if (createError) {
    console.warn('[telnyx/messaging/incoming] contact create failed', createError);
    return null;
  }

  return created as Record<string, unknown>;
}

async function resolveInboundLeadOwner(context: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
  salespersonUserId: string | null;
}): Promise<string | null> {
  if (context.salespersonUserId) return context.salespersonUserId;

  const { data: ownerMember } = await context.admin
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', context.workspaceId)
    .in('role', ['owner', 'admin'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  return typeof ownerMember?.user_id === 'string' ? ownerMember.user_id : null;
}

async function findOrCreateSalesLead(context: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
  salespersonId: string | null;
  salespersonUserId: string | null;
}, fromNumber: string, body: string): Promise<Record<string, unknown> | null> {
  const now = new Date().toISOString();
  const { data: existing } = await context.admin
    .from('sales_leads')
    .select('*')
    .eq('workspace_id', context.workspaceId)
    .or(`phone_e164.eq.${fromNumber},phone.eq.${fromNumber}`)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const { data: updated } = await context.admin
      .from('sales_leads')
      .update({
        phone_e164: fromNumber,
        lead_state: 'contacted',
        last_attempted_at: now,
        called_at: now,
        last_touch_at: now,
        last_touch_summary: 'Inbound SMS received',
        updated_at: now,
      })
      .eq('id', existing.id)
      .select('*')
      .single();

    return (updated ?? existing) as Record<string, unknown>;
  }

  const assignedUserId = await resolveInboundLeadOwner(context);
  if (!assignedUserId) return null;

  const { data: created, error: createError } = await context.admin
    .from('sales_leads')
    .insert({
      workspace_id: context.workspaceId,
      user_id: assignedUserId,
      assigned_user_id: assignedUserId,
      assigned_salesperson_id: context.salespersonId,
      created_by_user_id: assignedUserId,
      name: fromNumber,
      phone: fromNumber,
      phone_e164: fromNumber,
      source: 'salesperson_inbound_sms',
      lead_state: 'contacted',
      notes: `Inbound SMS: ${body}`,
      last_attempted_at: now,
      called_at: now,
      last_touch_at: now,
      last_touch_summary: 'Inbound SMS received',
      metadata: { inboundProvider: 'telnyx' },
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();

  if (createError) {
    console.warn('[telnyx/messaging/incoming] sales lead create failed', createError);
    return null;
  }

  return created as Record<string, unknown>;
}

async function notifyWorkspaceMembers(context: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
  salespersonUserId: string | null;
}, message: DialerInboundMessage, contactName: string | null): Promise<void> {
  let recipientUserIds = context.salespersonUserId ? [context.salespersonUserId] : [];
  if (recipientUserIds.length === 0) {
    const { data: members } = await context.admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', context.workspaceId);
    recipientUserIds = (members ?? [])
      .map((member) => (typeof member.user_id === 'string' ? member.user_id : null))
      .filter((userId): userId is string => Boolean(userId));
  }

  const title = contactName ? `New text from ${contactName}` : 'New dialler text';
  const rows = Array.from(new Set(recipientUserIds)).map((userId) => ({
    workspace_id: context.workspaceId,
    user_id: userId,
    type: 'dialer_inbound_sms',
    title,
    body: message.body,
    data: {
      workspaceId: context.workspaceId,
      source: 'sms',
      inboundMessageId: message.id,
      contactId: message.contact_id,
      salesLeadId: message.sales_lead_id,
      from: message.from_number_e164,
      to: message.to_number_e164,
    },
    read_at: null,
  }));

  if (rows.length > 0) {
    const { error } = await context.admin.from('notifications').insert(rows);
    if (error) console.warn('[telnyx/messaging/incoming] notification create failed', error);
  }
}

async function saveInboundMessage(
  admin: ReturnType<typeof createAdminClient>,
  insertPayload: Record<string, unknown>,
  messageId: string | null
) {
  if (messageId) {
    const { data: existing, error: existingError } = await admin
      .from('dialer_inbound_messages')
      .select('*')
      .eq('telecom_provider', 'telnyx')
      .eq('provider_message_id', messageId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError && existingError.code !== 'PGRST116') {
      return { data: null, error: existingError };
    }

    if (existing?.id) {
      return admin
        .from('dialer_inbound_messages')
        .update(insertPayload)
        .eq('id', existing.id)
        .select('*')
        .single();
    }
  }

  return admin
    .from('dialer_inbound_messages')
    .insert(insertPayload)
    .select('*')
    .single();
}

export async function POST(request: NextRequest) {
  const validation = await validateTelnyxWebhookRequest(request);
  if (!validation.isValid) return validation.response!;

  const { eventType, payload } = getPayload(validation.body);
  if (eventType && eventType !== 'message.received') return NextResponse.json({ ok: true });

  const fromNumber = getPhone(payload.from);
  const toNumber = getToPhone(payload.to);
  const body = cleanText(payload.text ?? payload.body);
  const messageId = cleanText(payload.id ?? payload.message_id) || null;

  if (!fromNumber || !toNumber || !body) return NextResponse.json({ ok: true });

  const admin = createAdminClient();
  const inboundRoute = await resolveInboundNumberRoute(admin, toNumber);
  if (!inboundRoute?.workspaceId) {
    console.warn('[telnyx/messaging/incoming] no workspace matched inbound text', { toNumber });
    return NextResponse.json({ ok: true });
  }

  const isSalespersonInbound = Boolean(inboundRoute.salespersonId || inboundRoute.salespersonUserId);
  const salesLead = isSalespersonInbound
    ? await findOrCreateSalesLead({
        admin,
        workspaceId: inboundRoute.workspaceId,
        salespersonId: inboundRoute.salespersonId,
        salespersonUserId: inboundRoute.salespersonUserId,
      }, fromNumber, body)
    : null;
  const contact = isSalespersonInbound
    ? null
    : await findOrCreateContact({ admin, workspaceId: inboundRoute.workspaceId }, fromNumber, body);
  const salesLeadId = typeof salesLead?.id === 'string' ? salesLead.id : null;
  const contactId = typeof contact?.id === 'string' ? contact.id : null;
  const now = new Date().toISOString();
  const insertPayload = {
    workspace_id: inboundRoute.workspaceId,
    salesperson_id: inboundRoute.salespersonId,
    contact_id: contactId,
    sales_lead_id: salesLeadId,
    telecom_provider: 'telnyx',
    provider_message_id: messageId,
    twilio_message_sid: null,
    from_number_e164: fromNumber,
    to_number_e164: toNumber,
    body,
    received_at: now,
    status_payload: validation.body,
  };

  const { data: inboundMessage, error: inboundError } = await saveInboundMessage(
    admin,
    insertPayload,
    messageId
  );

  if (inboundError) {
    console.error('[telnyx/messaging/incoming] failed to save inbound text', inboundError);
    return NextResponse.json({ ok: true });
  }

  if (salesLeadId) {
    const { error } = await admin.from('sales_activities').insert({
      workspace_id: inboundRoute.workspaceId,
      sales_lead_id: salesLeadId,
      actor_user_id: inboundRoute.salespersonUserId,
      activity_type: 'text',
      note: `Inbound SMS: ${body}`,
      occurred_at: now,
      metadata: {
        provider: 'telnyx',
        messageId,
        from: fromNumber,
        to: toNumber,
      },
    });
    if (error) console.warn('[telnyx/messaging/incoming] sales activity create failed', error);
  } else if (contactId) {
    const { error } = await admin.from('contact_activities').insert({
      contact_id: contactId,
      type: 'text',
      note: `Inbound SMS: ${body}`,
      timestamp: now,
    });
    if (error) console.warn('[telnyx/messaging/incoming] contact activity create failed', error);
  }

  const contactName =
    typeof salesLead?.name === 'string'
      ? salesLead.name
      : typeof contact?.full_name === 'string'
        ? contact.full_name
        : null;
  await notifyWorkspaceMembers(
    { admin, workspaceId: inboundRoute.workspaceId, salespersonUserId: inboundRoute.salespersonUserId },
    inboundMessage as DialerInboundMessage,
    contactName
  );

  return NextResponse.json({ ok: true });
}
