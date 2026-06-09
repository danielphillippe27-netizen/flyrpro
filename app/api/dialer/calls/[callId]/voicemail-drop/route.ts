import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import type { DialerCall } from '@/types/database';
import { getDialerRequestContext } from '@/lib/dialer/server';
import {
  getTwilioAccountSid,
  getTwilioAuthToken,
  getTwilioVoicemailDropAudioUrl,
  getTwilioVoicemailDropMessage,
} from '@/lib/dialer/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type VoicemailDropPayload = {
  workspaceId?: string;
};

async function getWorkspaceVoicemailDropAudioUrl(
  admin: ReturnType<typeof import('@/lib/supabase/server').createAdminClient>,
  workspaceId: string
): Promise<string | null> {
  const { data, error } = await admin
    .from('dialer_voicemail_drops')
    .select('public_url')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.warn('[dialer/voicemail-drop] failed to load workspace voicemail drop', error);
  }

  return typeof data?.public_url === 'string' && data.public_url.trim() ? data.public_url.trim() : null;
}

function buildVoicemailTwiml(audioUrl: string | null) {
  const response = new twilio.twiml.VoiceResponse();
  const resolvedAudioUrl = audioUrl || getTwilioVoicemailDropAudioUrl();

  if (resolvedAudioUrl) {
    response.play(resolvedAudioUrl);
  } else {
    response.say({ voice: 'alice' }, getTwilioVoicemailDropMessage());
  }

  response.hangup();
  return response.toString();
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ callId: string }> }
) {
  const body = (await request.json().catch(() => ({}))) as VoicemailDropPayload;
  const { callId } = await params;

  const context = await getDialerRequestContext(request, body.workspaceId);
  if (context instanceof NextResponse) {
    return context;
  }

  const { data: call, error } = await context.admin
    .from('dialer_calls')
    .select('*')
    .eq('id', callId)
    .eq('workspace_id', context.workspaceId)
    .eq('user_id', context.requestUser.id)
    .maybeSingle();

  if (error) {
    console.error('[dialer/voicemail-drop] failed to load call', error);
    return NextResponse.json({ error: 'Failed to load call details' }, { status: 500 });
  }

  if (!call) {
    return NextResponse.json({ error: 'Call not found' }, { status: 404 });
  }

  const activeCall = call as DialerCall;
  if (!activeCall.twilio_call_sid) {
    return NextResponse.json({ error: 'The live Twilio call leg is not available yet' }, { status: 409 });
  }

  try {
    const audioUrl = await getWorkspaceVoicemailDropAudioUrl(context.admin, context.workspaceId);
    const client = twilio(getTwilioAccountSid(), getTwilioAuthToken());
    await client.calls(activeCall.twilio_call_sid).update({
      twiml: buildVoicemailTwiml(audioUrl),
    });

    const nextPayload = {
      ...(typeof activeCall.status_payload === 'object' && activeCall.status_payload ? activeCall.status_payload : {}),
      voicemailDrop: {
        droppedAt: new Date().toISOString(),
        audioUrl: audioUrl || getTwilioVoicemailDropAudioUrl(),
      },
    };

    const { error: updateError } = await context.admin
      .from('dialer_calls')
      .update({
        status_payload: nextPayload,
        updated_at: new Date().toISOString(),
      })
      .eq('id', activeCall.id);

    if (updateError) {
      console.warn('[dialer/voicemail-drop] failed to persist voicemail metadata', updateError);
    }

    return NextResponse.json({ ok: true });
  } catch (dropError) {
    console.error('[dialer/voicemail-drop] failed to drop voicemail', dropError);
    return NextResponse.json(
      {
        error: dropError instanceof Error ? dropError.message : 'Failed to drop voicemail',
      },
      { status: 500 }
    );
  }
}
