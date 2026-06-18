import { NextRequest, NextResponse } from 'next/server';
import { validateTwilioWebhookRequest } from '@/lib/dialer/server';
import { createAdminClient } from '@/lib/supabase/server';
import { normalizePhoneNumber } from '@/lib/dialer/phone';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MISSED_STATUSES = new Set(['no-answer', 'busy', 'failed', 'canceled']);

async function resolveWorkspaceId(admin: ReturnType<typeof createAdminClient>, calledNumber: string | null): Promise<string | null> {
  if (!calledNumber) return null;
  const { data, error } = await admin
    .from('workspace_dialer_settings')
    .select('workspace_id')
    .or(`default_from_number.eq.${calledNumber},default_sms_from_number.eq.${calledNumber}`)
    .limit(1)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.warn('[twilio/incoming-status] workspace lookup failed', error);
  }

  return typeof data?.workspace_id === 'string' ? data.workspace_id : null;
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

async function notifyWorkspaceMembers(context: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
  inboxItemId: string;
  callerNumber: string | null;
  contactId: string | null;
}) {
  const { data: members, error } = await context.admin
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', context.workspaceId);

  if (error || !members?.length) {
    if (error) console.warn('[twilio/incoming-status] workspace member lookup failed', error);
    return;
  }

  const rows = members.flatMap((member) => {
    const userId = typeof member.user_id === 'string' ? member.user_id : null;
    if (!userId) return [];
    return [{
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
      },
      read_at: null,
    }];
  });

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
  const workspaceId = await resolveWorkspaceId(admin, calledNumber);
  if (!workspaceId) {
    console.warn('[twilio/incoming-status] no workspace matched missed call', { calledNumber });
    return NextResponse.json({ ok: true });
  }

  const contact = await findContactByPhone(admin, workspaceId, callerNumber);
  const contactId = typeof contact?.id === 'string' ? contact.id : null;
  const now = new Date().toISOString();
  const title = contact?.full_name
    ? `Missed call from ${contact.full_name}`
    : callerNumber
      ? `Missed call from ${callerNumber}`
      : 'Missed inbound call';

  const { data: inboxItem, error: inboxError } = await admin
    .from('inbox_items')
    .upsert({
      workspace_id: workspaceId,
      contact_id: contactId,
      source: 'call',
      source_table: 'twilio_incoming_calls',
      source_id: callSid,
      external_id: callSid,
      title,
      preview: callerNumber ? `Call back ${callerNumber}` : 'Call back this lead',
      from_label: typeof contact?.full_name === 'string' ? contact.full_name : callerNumber,
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
    inboxItemId: String(inboxItem.id),
    callerNumber,
    contactId,
  });

  return NextResponse.json({ ok: true });
}
