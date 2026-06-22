import { NextRequest, NextResponse } from 'next/server';
import type { DialerInboundMessage } from '@/types/database';
import { createAdminClient } from '@/lib/supabase/server';
import { getTwilioDefaultFromNumber, getTwilioDefaultSmsFromNumber } from '@/lib/dialer/env';
import { getDialerEnabledWorkspaceIds } from '@/lib/dialer/feature-gate';
import { normalizePhoneNumber } from '@/lib/dialer/phone';
import { validateTwilioWebhookRequest } from '@/lib/dialer/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type InboundNumberRoute = {
  workspaceId: string;
  salespersonId: string | null;
  salespersonUserId: string | null;
};

function cleanText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function phoneLookupCandidates(e164Number: string): string[] {
  const normalized = normalizePhoneNumber(e164Number);
  const digits = e164Number.replace(/\D/g, '');
  const localDigits = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  const localDashed = localDigits.length === 10
    ? `${localDigits.slice(0, 3)}-${localDigits.slice(3, 6)}-${localDigits.slice(6)}`
    : null;
  const localSpaced = localDigits.length === 10
    ? `${localDigits.slice(0, 3)} ${localDigits.slice(3, 6)} ${localDigits.slice(6)}`
    : null;
  const localParentheses = localDigits.length === 10
    ? `(${localDigits.slice(0, 3)}) ${localDigits.slice(3, 6)}-${localDigits.slice(6)}`
    : null;

  return Array.from(new Set([
    e164Number,
    normalized.national,
    digits,
    localDigits,
    localDashed,
    localSpaced,
    localParentheses,
  ].filter((value): value is string => Boolean(value && value.trim()))));
}

async function findExistingContact(context: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
}, fromNumber: string): Promise<Record<string, unknown> | null> {
  const { data: e164Match, error: e164Error } = await context.admin
    .from('contacts')
    .select('*')
    .eq('workspace_id', context.workspaceId)
    .eq('phone_e164', fromNumber)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (e164Error && e164Error.code !== 'PGRST116') {
    console.warn('[twilio/messaging/incoming] contact phone_e164 lookup failed', e164Error);
  }

  if (e164Match) return e164Match as Record<string, unknown>;

  const phoneCandidates = phoneLookupCandidates(fromNumber);
  const { data: phoneMatches, error: phoneError } = await context.admin
    .from('contacts')
    .select('*')
    .eq('workspace_id', context.workspaceId)
    .in('phone', phoneCandidates)
    .order('updated_at', { ascending: false })
    .limit(1);

  if (phoneError) {
    console.warn('[twilio/messaging/incoming] contact phone lookup failed', phoneError);
  }

  if (phoneMatches?.[0]) return phoneMatches[0] as Record<string, unknown>;

  const { data: fallbackRows, error: fallbackError } = await context.admin
    .from('contacts')
    .select('*')
    .eq('workspace_id', context.workspaceId)
    .not('phone', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(500);

  if (fallbackError) {
    console.warn('[twilio/messaging/incoming] contact normalized phone lookup failed', fallbackError);
    return null;
  }

  return (
    (fallbackRows ?? []).find((row) => normalizePhoneNumber((row as { phone?: string | null }).phone).e164 === fromNumber) ??
    null
  ) as Record<string, unknown> | null;
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
    console.warn('[twilio/messaging/incoming] salesperson number lookup failed', salespersonNumberError);
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
        console.warn('[twilio/messaging/incoming] salesperson user lookup failed', salespersonError);
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
    console.warn('[twilio/messaging/incoming] workspace lookup failed', error);
  }

  if (data?.workspace_id) {
    return { workspaceId: data.workspace_id as string, salespersonId: null, salespersonUserId: null };
  }

  const sharedSmsNumber = getTwilioDefaultSmsFromNumber();
  const sharedVoiceNumber = getTwilioDefaultFromNumber();
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
  const now = new Date().toISOString();
  const existing = await findExistingContact(context, fromNumber);
  if (existing) {
    const { data: updated, error: updateError } = await context.admin
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

    if (updateError) {
      console.warn('[twilio/messaging/incoming] contact update failed', updateError);
      return existing as Record<string, unknown>;
    }

    return updated as Record<string, unknown>;
  }

  const { data: ownerMember, error: ownerError } = await context.admin
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', context.workspaceId)
    .in('role', ['owner', 'admin'])
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (ownerError && ownerError.code !== 'PGRST116') {
    console.warn('[twilio/messaging/incoming] owner lookup failed', ownerError);
  }

  const fallbackUserId = typeof ownerMember?.user_id === 'string' ? ownerMember.user_id : null;
  if (!fallbackUserId) {
    console.warn('[twilio/messaging/incoming] no workspace owner found for inbound contact');
    return null;
  }

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
    console.warn('[twilio/messaging/incoming] contact create failed', createError);
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
    const { data: members, error } = await context.admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', context.workspaceId);

    if (error || !members?.length) {
      if (error) console.warn('[twilio/messaging/incoming] member lookup failed', error);
      return;
    }

    recipientUserIds = (members ?? [])
      .map((member) => (typeof member.user_id === 'string' ? member.user_id : null))
      .filter((userId): userId is string => Boolean(userId));
  }

  if (recipientUserIds.length === 0) {
    return;
  }

  const title = contactName ? `New text from ${contactName}` : 'New dialler text';
  const notificationRows = Array.from(new Set(recipientUserIds)).map((userId) => ({
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
      from: message.from_number_e164,
      to: message.to_number_e164,
    },
    read_at: null,
  }));

  if (notificationRows.length === 0) return;

  const { error: notificationError } = await context.admin
    .from('notifications')
    .insert(notificationRows);

  if (notificationError) {
    console.warn('[twilio/messaging/incoming] notification create failed', notificationError);
  }
}

export async function POST(request: NextRequest) {
  const validation = await validateTwilioWebhookRequest(request);
  if (!validation.isValid) return validation.response!;

  const fromNumber = normalizePhoneNumber(validation.params.From).e164;
  const toNumber = normalizePhoneNumber(validation.params.To).e164;
  const body = cleanText(validation.params.Body);
  const messageSid = cleanText(validation.params.MessageSid) || null;

  if (!fromNumber || !toNumber || !body) {
    return NextResponse.json({ ok: true });
  }

  const admin = createAdminClient();
  const inboundRoute = await resolveInboundNumberRoute(admin, toNumber);
  if (!inboundRoute?.workspaceId) {
    console.warn('[twilio/messaging/incoming] no workspace matched inbound text', { toNumber });
    return NextResponse.json({ ok: true });
  }
  const { workspaceId, salespersonId, salespersonUserId } = inboundRoute;

  const contact = await findOrCreateContact({ admin, workspaceId }, fromNumber, body);
  const contactId = typeof contact?.id === 'string' ? contact.id : null;
  const now = new Date().toISOString();

  const insertPayload = {
    workspace_id: workspaceId,
    salesperson_id: salespersonId,
    contact_id: contactId,
    telecom_provider: 'twilio',
    provider_message_id: messageSid,
    twilio_message_sid: messageSid,
    from_number_e164: fromNumber,
    to_number_e164: toNumber,
    body,
    received_at: now,
    status_payload: validation.params,
  };

  const { data: inboundMessage, error: inboundError } = messageSid
    ? await admin
        .from('dialer_inbound_messages')
        .upsert(insertPayload, { onConflict: 'twilio_message_sid' })
        .select('*')
        .single()
    : await admin
        .from('dialer_inbound_messages')
        .insert(insertPayload)
        .select('*')
        .single();

  if (inboundError) {
    console.error('[twilio/messaging/incoming] failed to save inbound text', inboundError);
    return NextResponse.json({ ok: true });
  }

  if (contactId) {
    const { error: activityError } = await admin.from('contact_activities').insert({
      contact_id: contactId,
      type: 'text',
      note: `Inbound SMS: ${body}`,
      timestamp: now,
    });

    if (activityError) {
      console.warn('[twilio/messaging/incoming] contact activity create failed', activityError);
    }
  }

  const contactName = typeof contact?.full_name === 'string' ? contact.full_name : null;
  await notifyWorkspaceMembers(
    { admin, workspaceId, salespersonUserId },
    inboundMessage as DialerInboundMessage,
    contactName
  );

  return NextResponse.json({ ok: true });
}
