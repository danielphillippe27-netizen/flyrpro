import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { isFinalCallStatus } from '@/lib/dialer/constants';
import { getTelnyxInboundFallbackMessage } from '@/lib/dialer/env';
import { normalizePhoneNumber } from '@/lib/dialer/phone';
import {
  answerTelnyxCall,
  buildPublicTelnyxWebhookUrl,
  decodeTelnyxClientState,
  dialTelnyxCall,
  hangupTelnyxCall,
  transferTelnyxCall,
  validateTelnyxWebhookRequest,
} from '@/lib/dialer/telnyx';
import { getTelnyxForwardToNumber } from '@/lib/dialer/telnyx-voice';

type TelnyxVoiceEvent = {
  eventType: string | null;
  payload: Record<string, unknown>;
};

function getTelnyxVoiceEvent(body: Record<string, unknown>): TelnyxVoiceEvent {
  const data = body.data && typeof body.data === 'object' ? body.data as Record<string, unknown> : body;
  const payload = data.payload && typeof data.payload === 'object' ? data.payload as Record<string, unknown> : data;
  return {
    eventType: typeof data.event_type === 'string' ? data.event_type : null,
    payload,
  };
}

function getString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getCallControlId(payload: Record<string, unknown>): string | null {
  return getString(payload, 'call_control_id');
}

function getNestedRecord(value: unknown, key: string): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  const nested = (value as Record<string, unknown>)[key];
  return nested && typeof nested === 'object' ? nested as Record<string, unknown> : null;
}

function getFirstString(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const direct = getString(payload, key);
    if (direct) return direct;
  }

  const recording = getNestedRecord(payload, 'recording');
  if (recording) {
    for (const key of keys) {
      const nested = getString(recording, key);
      if (nested) return nested;
    }
  }

  return null;
}

function getRecordingUrl(payload: Record<string, unknown>): string | null {
  const direct = getFirstString(payload, [
    'recording_url',
    'recording_urls',
    'download_url',
    'download_urls',
    'media_url',
    'mp3_url',
    'url',
  ]);
  if (direct) return direct;

  const urls = payload.recording_urls ?? getNestedRecord(payload, 'recording')?.recording_urls;
  if (Array.isArray(urls)) {
    return urls.find((url): url is string => typeof url === 'string' && url.trim().length > 0) ?? null;
  }
  if (urls && typeof urls === 'object') {
    const record = urls as Record<string, unknown>;
    return (
      (typeof record.mp3 === 'string' && record.mp3) ||
      (typeof record.audio === 'string' && record.audio) ||
      (typeof record.url === 'string' && record.url) ||
      null
    );
  }

  return null;
}

function resolveRecordingMp3Url(recordingUrl: string | null): string | null {
  if (!recordingUrl) return null;
  return recordingUrl.endsWith('.mp3') || /format=mp3/i.test(recordingUrl) ? recordingUrl : recordingUrl;
}

function getRecordingMetadata(eventType: string | null, payload: Record<string, unknown>, now: string) {
  if (!eventType?.startsWith('recording.')) return null;
  const recordingUrl = getRecordingUrl(payload);
  const recordingId = getFirstString(payload, [
    'recording_id',
    'recording_sid',
    'id',
    'recording_uuid',
  ]);
  const status =
    getFirstString(payload, ['status', 'recording_status']) ||
    (eventType.includes('saved') || eventType.includes('completed') ? 'completed' : 'pending');
  const durationSeconds = getDurationSeconds(payload);
  const channels =
    Number(getFirstString(payload, ['channels', 'recording_channels']) ?? payload.channels ?? 0) || null;
  const errorCode = getFirstString(payload, ['error_code', 'errorCode']);

  if (!recordingId && !recordingUrl) return null;

  return {
    provider: 'telnyx',
    recordingSid: recordingId ?? recordingUrl,
    recordingUrl,
    mp3Url: resolveRecordingMp3Url(recordingUrl),
    status,
    durationSeconds,
    channels,
    errorCode,
    updatedAt: now,
    lastWebhook: payload,
  };
}

function mapTelnyxCallStatus(eventType: string | null, payload: Record<string, unknown>): string | null {
  switch (eventType) {
    case 'call.initiated':
      return 'initiated';
    case 'call.answered':
    case 'call.bridged':
      return 'answered';
    case 'call.hangup': {
      const cause = getString(payload, 'hangup_cause') ?? getString(payload, 'sip_hangup_cause');
      if (cause && /busy/i.test(cause)) return 'busy';
      if (cause && /(timeout|no.?answer)/i.test(cause)) return 'no-answer';
      if (cause && /(cancel|originator_cancel)/i.test(cause)) return 'canceled';
      if (cause && /(fail|reject|error)/i.test(cause)) return 'failed';
      return 'completed';
    }
    default:
      return null;
  }
}

function getDurationSeconds(payload: Record<string, unknown>): number | null {
  const value = payload.call_duration ?? payload.duration ?? payload.duration_secs;
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0;
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

async function findDialerCall(
  admin: ReturnType<typeof createAdminClient>,
  callRequestId: string | null,
  callControlId: string | null
) {
  let query = admin.from('dialer_calls').select('*');
  if (callRequestId) {
    query = query.eq('call_request_id', callRequestId);
  } else if (callControlId) {
    query = query
      .eq('telecom_provider', 'telnyx')
      .or(`provider_call_id.eq.${callControlId},provider_parent_call_id.eq.${callControlId}`);
  } else {
    return { data: null, error: null };
  }

  return query.order('created_at', { ascending: false }).limit(1).maybeSingle();
}

async function dialLeadAfterAgentAnswer(params: {
  request: NextRequest;
  admin: ReturnType<typeof createAdminClient>;
  call: Record<string, unknown>;
  callControlId: string;
  payload: Record<string, unknown>;
  callRequestId: string;
}) {
  const existingPayload =
    typeof params.call.status_payload === 'object' && params.call.status_payload
      ? params.call.status_payload as Record<string, unknown>
      : {};
  const existingTelnyx =
    typeof existingPayload.telnyx === 'object' && existingPayload.telnyx
      ? existingPayload.telnyx as Record<string, unknown>
      : {};

  if (typeof existingTelnyx.leadCallControlId === 'string' && existingTelnyx.leadCallControlId) {
    return existingPayload;
  }

  const clientState = decodeTelnyxClientState(params.payload.client_state);
  const from = normalizePhoneNumber(clientState.from ?? params.call.from_number_e164 as string | null).e164;
  const leadTo = normalizePhoneNumber(clientState.to ?? params.call.to_number_e164 as string | null).e164;
  if (!from || !leadTo) {
    return {
      ...existingPayload,
      telnyx: {
        ...existingTelnyx,
        bridgeError: 'Missing caller ID or lead destination for Telnyx bridge.',
        bridgeErrorAt: new Date().toISOString(),
      },
    };
  }

  const webhookUrl = buildPublicTelnyxWebhookUrl(params.request, '/api/telnyx/voice/status').toString();
  const leadDial = await dialTelnyxCall({
    from,
    to: leadTo,
    webhookUrl,
    linkTo: params.callControlId,
    bridgeIntent: true,
    bridgeOnAnswer: true,
    record: 'record-from-answer',
    commandId: `${params.callRequestId}:lead`,
    clientState: {
      callRequestId: params.callRequestId,
      role: 'lead',
      direction: 'outbound',
      from,
      to: leadTo,
      forwardTo: clientState.forwardTo ?? null,
    },
  });

  return {
    ...existingPayload,
    telnyx: {
      ...existingTelnyx,
      leadCallControlId: leadDial.callControlId,
      leadCallLegId: leadDial.callLegId,
      leadCallSessionId: leadDial.callSessionId,
      leadDialStartedAt: new Date().toISOString(),
      leadDialRaw: leadDial.raw,
    },
  };
}

async function handleInboundCall(params: {
  eventType: string | null;
  payload: Record<string, unknown>;
  callControlId: string | null;
}) {
  if (params.eventType !== 'call.initiated' || !params.callControlId) return;
  const direction = getString(params.payload, 'direction');
  if (direction !== 'incoming') return;

  const from = normalizePhoneNumber(getString(params.payload, 'to')).e164;
  const forwardTo = getTelnyxForwardToNumber();
  if (!forwardTo) {
    await hangupTelnyxCall(params.callControlId, { commandId: `${params.callControlId}:no-forward` });
    return;
  }

  await answerTelnyxCall(params.callControlId, {
    commandId: `${params.callControlId}:answer`,
    clientState: {
      role: 'inbound',
      direction: 'inbound',
      from,
      to: normalizePhoneNumber(getString(params.payload, 'from')).e164,
      forwardTo,
    },
  });

  await transferTelnyxCall(params.callControlId, {
    to: forwardTo,
    from,
    timeoutSecs: 45,
    commandId: `${params.callControlId}:forward`,
    clientState: {
      role: 'inbound',
      direction: 'inbound',
      from,
      to: normalizePhoneNumber(getString(params.payload, 'from')).e164,
      forwardTo,
    },
  });
}

export async function handleTelnyxVoiceWebhook(request: NextRequest) {
  const validation = await validateTelnyxWebhookRequest(request);
  if (!validation.isValid) return validation.response!;

  const { eventType, payload } = getTelnyxVoiceEvent(validation.body);
  const callControlId = getCallControlId(payload);
  const clientState = decodeTelnyxClientState(payload.client_state);
  const callRequestId = clientState.callRequestId ?? null;

  try {
    await handleInboundCall({ eventType, payload, callControlId });
  } catch (error) {
    console.error('[telnyx/voice] failed to handle inbound call command', error, {
      message: getTelnyxInboundFallbackMessage(),
    });
  }

  const admin = createAdminClient();
  const { data: call, error: callError } = await findDialerCall(admin, callRequestId, callControlId);
  if (callError) {
    console.error('[telnyx/voice] failed to load dialer call', callError);
    return NextResponse.json({ ok: true });
  }

  if (!call) {
    return NextResponse.json({ ok: true });
  }

  const now = new Date().toISOString();
  let nextStatusPayload = {
    ...(typeof call.status_payload === 'object' && call.status_payload ? call.status_payload : {}),
    lastWebhook: validation.body,
  };
  const recordingMetadata = getRecordingMetadata(eventType, payload, now);
  if (recordingMetadata) {
    nextStatusPayload = {
      ...nextStatusPayload,
      recording: recordingMetadata,
    };
  }

  if (eventType === 'call.answered' && clientState.role === 'agent' && callControlId && callRequestId) {
    try {
      nextStatusPayload = await dialLeadAfterAgentAnswer({
        request,
        admin,
        call: call as Record<string, unknown>,
        callControlId,
        payload,
        callRequestId,
      });
    } catch (error) {
      console.error('[telnyx/voice] failed to dial bridged lead leg', error);
      const telnyxPayload =
        typeof nextStatusPayload.telnyx === 'object' && nextStatusPayload.telnyx
          ? nextStatusPayload.telnyx as Record<string, unknown>
          : {};
      nextStatusPayload = {
        ...nextStatusPayload,
        telnyx: {
          ...telnyxPayload,
          bridgeError: error instanceof Error ? error.message : 'Failed to dial bridged lead leg.',
          bridgeErrorAt: now,
        },
      };
    }
  }

  let resolvedStatus = mapTelnyxCallStatus(eventType, payload);
  if (clientState.role === 'agent' && eventType === 'call.answered') {
    resolvedStatus = 'ringing';
  }
  const durationSeconds = getDurationSeconds(payload);
  const updatePayload: Record<string, unknown> = {
    telecom_provider: 'telnyx',
    status_payload: nextStatusPayload,
    updated_at: now,
  };

  if (clientState.role === 'lead') {
    updatePayload.provider_call_id = callControlId ?? call.provider_call_id;
  } else if (clientState.role === 'agent') {
    updatePayload.provider_parent_call_id = callControlId ?? call.provider_parent_call_id;
  }
  if (resolvedStatus) {
    updatePayload.status = resolvedStatus;
  }
  if ((resolvedStatus === 'answered' || eventType === 'call.bridged') && !call.answered_at) {
    updatePayload.answered_at = now;
  }
  if (durationSeconds) {
    updatePayload.duration_seconds = durationSeconds;
  }
  if (isFinalCallStatus(resolvedStatus) && !call.ended_at) {
    updatePayload.ended_at = now;
  }

  const { error: updateError } = await admin
    .from('dialer_calls')
    .update(updatePayload)
    .eq('id', call.id);

  if (updateError) {
    console.error('[telnyx/voice] failed to update dialer call', updateError);
  }

  return NextResponse.json({ ok: true });
}
