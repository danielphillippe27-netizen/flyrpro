import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { validateTelnyxWebhookRequest } from '@/lib/dialer/telnyx';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getEventData(body: Record<string, unknown>) {
  const data = body.data && typeof body.data === 'object' ? body.data as Record<string, unknown> : body;
  const payload = data.payload && typeof data.payload === 'object' ? data.payload as Record<string, unknown> : data;
  return {
    eventType: typeof data.event_type === 'string' ? data.event_type : null,
    payload,
  };
}

function getMessageId(payload: Record<string, unknown>): string | null {
  const id = payload.id ?? payload.message_id ?? payload.record_id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

function getMessageStatus(payload: Record<string, unknown>): string | null {
  if (typeof payload.status === 'string') return payload.status;
  const to = Array.isArray(payload.to) ? payload.to[0] : null;
  if (to && typeof to === 'object' && typeof (to as Record<string, unknown>).status === 'string') {
    return (to as Record<string, unknown>).status as string;
  }
  return null;
}

function getErrorField(payload: Record<string, unknown>, key: 'code' | 'detail'): string | null {
  const errors = Array.isArray(payload.errors) ? payload.errors : [];
  const first = errors[0] as Record<string, unknown> | undefined;
  const value = first?.[key] ?? first?.title;
  return typeof value === 'string' ? value : null;
}

function isSentStatus(status: string | null | undefined) {
  return status === 'sent' || status === 'delivered' || status === 'queued';
}

export async function POST(request: NextRequest) {
  const validation = await validateTelnyxWebhookRequest(request);
  if (!validation.isValid) return validation.response!;

  const { eventType, payload } = getEventData(validation.body);
  if (eventType && !['message.sent', 'message.finalized'].includes(eventType)) {
    return NextResponse.json({ ok: true });
  }

  const messageId = getMessageId(payload);
  if (!messageId) return NextResponse.json({ ok: true });

  const admin = createAdminClient();
  const { data: followup, error: followupError } = await admin
    .from('dialer_sms_followups')
    .select('*')
    .or(`provider_message_id.eq.${messageId},twilio_message_sid.eq.${messageId}`)
    .maybeSingle();

  if (followupError) {
    console.error('[telnyx/messaging/status] failed to load follow-up', followupError);
    return NextResponse.json({ ok: true });
  }

  if (!followup) return NextResponse.json({ ok: true });

  const now = new Date().toISOString();
  const status = getMessageStatus(payload);
  const nextPayload = {
    ...(typeof followup.status_payload === 'object' && followup.status_payload ? followup.status_payload : {}),
    lastWebhook: validation.body,
  };

  const updatePayload: Record<string, unknown> = {
    telecom_provider: 'telnyx',
    provider_message_id: messageId,
    status: status ?? followup.status,
    error_code: getErrorField(payload, 'code') ?? followup.error_code,
    error_message: getErrorField(payload, 'detail') ?? followup.error_message,
    status_payload: nextPayload,
    updated_at: now,
  };

  if (isSentStatus(status) && !followup.sent_at) {
    updatePayload.sent_at = now;
  }
  if (status === 'delivered' && !followup.delivered_at) {
    updatePayload.delivered_at = now;
  }

  const { error: updateError } = await admin
    .from('dialer_sms_followups')
    .update(updatePayload)
    .eq('id', followup.id);

  if (updateError) {
    console.error('[telnyx/messaging/status] failed to update follow-up', updateError);
  }

  return NextResponse.json({ ok: true });
}
