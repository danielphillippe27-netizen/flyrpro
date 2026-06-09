import { NextRequest, NextResponse } from 'next/server';
import type { DialerInboundMessage } from '@/types/database';
import { createAdminClient } from '@/lib/supabase/server';
import { getTwilioDefaultFromNumber, getTwilioDefaultSmsFromNumber } from '@/lib/dialer/env';
import { getDialerEnabledWorkspaceIds } from '@/lib/dialer/feature-gate';
import { normalizePhoneNumber } from '@/lib/dialer/phone';
import { validateTwilioWebhookRequest } from '@/lib/dialer/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function cleanText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function getFallbackWorkspaceId(): string | null {
  const enabledWorkspaceIds = getDialerEnabledWorkspaceIds();
  return enabledWorkspaceIds.length === 1 ? enabledWorkspaceIds[0] : null;
}

async function resolveWorkspaceId(admin: ReturnType<typeof createAdminClient>, toNumber: string): Promise<string | null> {
  const { data, error } = await admin
    .from('workspace_dialer_settings')
    .select('workspace_id')
    .or(`default_sms_from_number.eq.${toNumber},default_from_number.eq.${toNumber}`)
    .limit(1)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.warn('[twilio/messaging/incoming] workspace lookup failed', error);
  }

  if (data?.workspace_id) return data.workspace_id as string;

  const sharedSmsNumber = getTwilioDefaultSmsFromNumber();
  const sharedVoiceNumber = getTwilioDefaultFromNumber();
  if (toNumber === sharedSmsNumber || toNumber === sharedVoiceNumber) {
    return getFallbackWorkspaceId();
  }

  return null;
}

async function findOrCreateContact(context: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
}, fromNumber: string, body: string): Promise<Record<string, unknown> | null> {
  const { data: existing, error: lookupError } = await context.admin
    .from('contacts')
    .select('*')
    .eq('workspace_id', context.workspaceId)
    .eq('phone_e164', fromNumber)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lookupError && lookupError.code !== 'PGRST116') {
    console.warn('[twilio/messaging/incoming] contact lookup failed', lookupError);
  }

  const now = new Date().toISOString();
  if (existing) {
    const { data: updated, error: updateError } = await context.admin
      .from('contacts')
      .update({
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
}, message: DialerInboundMessage, contactName: string | null): Promise<void> {
  const { data: members, error } = await context.admin
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', context.workspaceId);

  if (error || !members?.length) {
    if (error) console.warn('[twilio/messaging/incoming] member lookup failed', error);
    return;
  }

  const title = contactName ? `New text from ${contactName}` : 'New dialler text';
  const notificationRows = members.flatMap((member) => {
    const userId = typeof member.user_id === 'string' ? member.user_id : null;
    if (!userId) return [];
    return [{
      user_id: userId,
      type: 'dialer_inbound_sms',
      title,
      message: message.body,
      data: {
        workspaceId: context.workspaceId,
        inboundMessageId: message.id,
        contactId: message.contact_id,
        from: message.from_number_e164,
        to: message.to_number_e164,
      },
      is_read: false,
    }];
  });

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
  const workspaceId = await resolveWorkspaceId(admin, toNumber);
  if (!workspaceId) {
    console.warn('[twilio/messaging/incoming] no workspace matched inbound text', { toNumber });
    return NextResponse.json({ ok: true });
  }

  const contact = await findOrCreateContact({ admin, workspaceId }, fromNumber, body);
  const contactId = typeof contact?.id === 'string' ? contact.id : null;
  const now = new Date().toISOString();

  const insertPayload = {
    workspace_id: workspaceId,
    contact_id: contactId,
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
  await notifyWorkspaceMembers({ admin, workspaceId }, inboundMessage as DialerInboundMessage, contactName);

  return NextResponse.json({ ok: true });
}
