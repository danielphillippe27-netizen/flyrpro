import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import type { DialerCall, DialerVoicemailDrop } from '@/types/database';
import { getDialerRequestContext } from '@/lib/dialer/server';
import {
  getTwilioAccountSid,
  getTwilioAuthToken,
} from '@/lib/dialer/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type VoicemailDropPayload = {
  workspaceId?: string;
  voicemailDropId?: string;
};

async function getWorkspaceVoicemailDrop(
  admin: ReturnType<typeof import('@/lib/supabase/server').createAdminClient>,
  workspaceId: string,
  voicemailDropId?: string
): Promise<DialerVoicemailDrop | null> {
  let query = admin
    .from('dialer_voicemail_drops')
    .select('*')
    .eq('workspace_id', workspaceId);

  if (voicemailDropId) {
    query = query.eq('id', voicemailDropId);
  } else {
    query = query.eq('is_active', true).order('created_at', { ascending: false }).limit(1);
  }

  const { data, error } = await query.maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.warn('[dialer/voicemail-drop] failed to load workspace voicemail drop', error);
  }

  return typeof data?.public_url === 'string' && data.public_url.trim() ? data as DialerVoicemailDrop : null;
}

function buildVoicemailTwiml(audioUrl: string) {
  const response = new twilio.twiml.VoiceResponse();
  response.play(audioUrl);
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
    const voicemailDrop = await getWorkspaceVoicemailDrop(context.admin, context.workspaceId, body.voicemailDropId);
    if (!voicemailDrop) {
      return NextResponse.json(
        { error: body.voicemailDropId ? 'Selected voicemail recording was not found.' : 'Upload and activate a prerecorded voicemail before using voicemail drop.' },
        { status: 409 }
      );
    }

    const client = twilio(getTwilioAccountSid(), getTwilioAuthToken());
    await client.calls(activeCall.twilio_call_sid).update({
      twiml: buildVoicemailTwiml(voicemailDrop.public_url),
    });

    const nextPayload = {
      ...(typeof activeCall.status_payload === 'object' && activeCall.status_payload ? activeCall.status_payload : {}),
      voicemailDrop: {
        droppedAt: new Date().toISOString(),
        id: voicemailDrop.id,
        filename: voicemailDrop.filename,
        audioUrl: voicemailDrop.public_url,
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
