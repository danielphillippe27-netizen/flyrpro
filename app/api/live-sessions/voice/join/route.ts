import { NextRequest, NextResponse } from 'next/server';
import { AccessToken } from 'livekit-server-sdk';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TOKEN_TTL_SECONDS = 15 * 60;

type JoinVoiceBody = {
  session_id?: string;
  sessionId?: string;
  campaign_id?: string;
  campaignId?: string;
};

type SessionRow = {
  id: string;
  user_id: string;
  campaign_id: string | null;
  workspace_id: string | null;
  end_time: string | null;
};

function configuredLiveKit() {
  const url = process.env.LIVEKIT_URL?.trim();
  const apiKey = process.env.LIVEKIT_API_KEY?.trim();
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim();
  return url && apiKey && apiSecret ? { url, apiKey, apiSecret } : null;
}

function participantName(email: string | null, metadata: Record<string, unknown> | undefined): string {
  const candidates = [metadata?.full_name, metadata?.name, metadata?.display_name];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return email?.split('@')[0]?.trim() || 'Teammate';
}

export async function POST(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as JoinVoiceBody;
    const sessionId = body.session_id?.trim() || body.sessionId?.trim();
    const requestedCampaignId = body.campaign_id?.trim() || body.campaignId?.trim();
    if (!sessionId) {
      return NextResponse.json({ error: 'session_id is required.' }, { status: 400 });
    }

    const liveKit = configuredLiveKit();
    if (!liveKit) {
      console.error('[live-sessions/voice/join] LiveKit environment is incomplete.');
      return NextResponse.json({ error: 'Session voice is not configured.' }, { status: 503 });
    }

    const admin = createAdminClient();
    const { data: sessionData, error: sessionError } = await admin
      .from('sessions')
      .select('id,user_id,campaign_id,workspace_id,end_time')
      .eq('id', sessionId)
      .maybeSingle();

    if (sessionError) {
      console.error('[live-sessions/voice/join] session lookup failed:', sessionError);
      return NextResponse.json({ error: 'Unable to load live session.' }, { status: 500 });
    }

    const session = sessionData as SessionRow | null;
    if (!session) {
      return NextResponse.json({ error: 'Live session not found.' }, { status: 404 });
    }
    if (session.end_time) {
      return NextResponse.json({ error: 'This live session has ended.' }, { status: 409 });
    }
    if (!session.campaign_id) {
      return NextResponse.json({ error: 'This session is not attached to a campaign.' }, { status: 409 });
    }
    if (requestedCampaignId && requestedCampaignId !== session.campaign_id) {
      return NextResponse.json({ error: 'campaign_id does not match this session.' }, { status: 400 });
    }

    let authorized = session.user_id === requestUser.id;
    if (!authorized) {
      const { data: participant, error: participantError } = await admin
        .from('session_participants')
        .select('id')
        .eq('session_id', session.id)
        .eq('user_id', requestUser.id)
        .is('left_at', null)
        .maybeSingle();
      if (participantError) {
        console.error('[live-sessions/voice/join] participant lookup failed:', participantError);
        return NextResponse.json({ error: 'Unable to authorize session voice.' }, { status: 500 });
      }
      authorized = Boolean(participant);
    }

    if (!authorized) {
      return NextResponse.json(
        { error: 'Voice is only available to teammates in this live session.' },
        { status: 403 }
      );
    }

    const { data: authUserData } = await admin.auth.admin.getUserById(requestUser.id);
    const name = participantName(
      authUserData.user?.email ?? requestUser.email,
      authUserData.user?.user_metadata as Record<string, unknown> | undefined
    );
    // Keep the established room namespace so existing iOS clients and active rooms interoperate.
    const roomName = `flyr-session-${session.id.toLowerCase()}`;
    const metadata = JSON.stringify({
      user_id: requestUser.id,
      campaign_id: session.campaign_id,
      workspace_id: session.workspace_id,
      session_id: session.id,
      feature: 'session_voice',
    });
    const accessToken = new AccessToken(liveKit.apiKey, liveKit.apiSecret, {
      identity: requestUser.id,
      name,
      metadata,
      ttl: TOKEN_TTL_SECONDS,
    });
    accessToken.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
    });

    const token = await accessToken.toJwt();
    return NextResponse.json({
      room_name: roomName,
      participant_identity: requestUser.id,
      participant_name: name,
      livekit_url: liveKit.url,
      token,
      expires_in_seconds: TOKEN_TTL_SECONDS,
    });
  } catch (error) {
    console.error('[live-sessions/voice/join] failed:', error);
    return NextResponse.json({ error: 'Unable to join session voice.' }, { status: 500 });
  }
}
