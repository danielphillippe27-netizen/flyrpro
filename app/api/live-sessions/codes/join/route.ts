import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  LIVE_SESSION_CODE_LENGTH,
  hashLiveSessionCode,
  sanitizeLiveSessionCode,
} from '@/app/api/live-sessions/_lib/live-session-codes';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type JoinLiveSessionCodeBody = {
  code?: string;
};

type LiveSessionCodeRow = {
  id: string;
  session_id: string;
  campaign_id: string;
  workspace_id: string | null;
  revoked_at: string | null;
  expires_at: string;
};

type SessionRow = {
  id: string;
  user_id: string;
  campaign_id: string | null;
  workspace_id: string | null;
  end_time: string | null;
};

type CampaignRow = {
  id: string;
  title: string | null;
  name?: string | null;
  owner_id: string;
  workspace_id: string | null;
};

type DatabaseError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

function errorText(error: DatabaseError | null | undefined): string {
  return [error?.message, error?.details, error?.hint].filter(Boolean).join(' ').toLowerCase();
}

function isMissingRelation(error: DatabaseError | null | undefined, relation: string): boolean {
  const text = errorText(error);
  return (
    text.includes(relation.toLowerCase()) &&
    (text.includes('does not exist') || text.includes('relation') || text.includes('schema cache'))
  );
}

export async function POST(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as JoinLiveSessionCodeBody;
    const sanitizedCode = sanitizeLiveSessionCode(body.code ?? '');
    if (sanitizedCode.length !== LIVE_SESSION_CODE_LENGTH) {
      return NextResponse.json(
        { error: `Enter the ${LIVE_SESSION_CODE_LENGTH}-character session code.` },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const { data: codeData, error: codeError } = await admin
      .from('live_session_codes')
      .select('id,session_id,campaign_id,workspace_id,revoked_at,expires_at')
      .eq('code_hash', hashLiveSessionCode(sanitizedCode))
      .maybeSingle();

    if (codeError) {
      console.error('[live-sessions/codes/join] code lookup error:', codeError);
      if (isMissingRelation(codeError, 'live_session_codes')) {
        return NextResponse.json(
          { error: 'Live session codes are not live on the backend yet.' },
          { status: 500 }
        );
      }
      return NextResponse.json({ error: 'Unable to verify session code.' }, { status: 500 });
    }

    const liveSessionCode = codeData as LiveSessionCodeRow | null;
    if (!liveSessionCode) {
      return NextResponse.json({ error: 'Invalid session code.' }, { status: 404 });
    }

    if (liveSessionCode.revoked_at || new Date(liveSessionCode.expires_at) <= new Date()) {
      return NextResponse.json({ error: 'This session code has expired.' }, { status: 400 });
    }

    const [{ data: sessionData, error: sessionError }, { data: campaignData, error: campaignError }] =
      await Promise.all([
        admin
          .from('sessions')
          .select('id,user_id,campaign_id,workspace_id,end_time')
          .eq('id', liveSessionCode.session_id)
          .maybeSingle(),
        admin
          .from('campaigns')
          .select('id,title,name,owner_id,workspace_id')
          .eq('id', liveSessionCode.campaign_id)
          .maybeSingle(),
      ]);

    if (sessionError) {
      console.error('[live-sessions/codes/join] session lookup error:', sessionError);
      return NextResponse.json({ error: 'Unable to load live session.' }, { status: 500 });
    }

    if (campaignError) {
      console.error('[live-sessions/codes/join] campaign lookup error:', campaignError);
      return NextResponse.json({ error: 'Unable to load campaign.' }, { status: 500 });
    }

    const session = sessionData as SessionRow | null;
    const campaign = campaignData as CampaignRow | null;
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found.' }, { status: 404 });
    }

    if (!session || session.end_time) {
      return NextResponse.json(
        { error: 'This live session has ended. Ask your teammate for a fresh code.' },
        { status: 400 }
      );
    }

    if (!session.campaign_id || session.campaign_id !== campaign.id) {
      return NextResponse.json(
        { error: 'This session code no longer points to an active campaign session.' },
        { status: 400 }
      );
    }

    if (campaign.owner_id !== requestUser.id) {
      const { error: campaignMemberError } = await admin.from('campaign_members').upsert(
        {
          campaign_id: campaign.id,
          user_id: requestUser.id,
          role: 'member',
        },
        { onConflict: 'campaign_id,user_id' }
      );

      if (campaignMemberError && !isMissingRelation(campaignMemberError, 'campaign_members')) {
        console.error('[live-sessions/codes/join] campaign member upsert error:', campaignMemberError);
        return NextResponse.json({ error: 'Unable to join this campaign.' }, { status: 500 });
      }
    }

    const joinedAt = new Date().toISOString();
    const participantRole = session.user_id === requestUser.id ? 'host' : 'member';
    const participantUpsert = await admin.from('session_participants').upsert(
      {
        session_id: session.id,
        campaign_id: campaign.id,
        user_id: requestUser.id,
        role: participantRole,
        joined_at: joinedAt,
        left_at: null,
        last_seen_at: joinedAt,
      },
      { onConflict: 'session_id,user_id' }
    );

    if (participantUpsert.error && !isMissingRelation(participantUpsert.error, 'session_participants')) {
      console.error('[live-sessions/codes/join] session participant upsert error:', participantUpsert.error);
      return NextResponse.json({ error: 'Unable to join this live session.' }, { status: 500 });
    }

    const { error: codeTouchError } = await admin
      .from('live_session_codes')
      .update({ last_used_at: joinedAt })
      .eq('id', liveSessionCode.id);

    if (codeTouchError) {
      console.error('[live-sessions/codes/join] code touch error:', codeTouchError);
    }

    const workspaceId = campaign.workspace_id ?? session.workspace_id ?? liveSessionCode.workspace_id;
    const campaignTitle = campaign.title || campaign.name || 'Campaign';
    return NextResponse.json({
      success: true,
      workspace_id: workspaceId,
      workspaceId,
      campaign_id: campaign.id,
      campaignId: campaign.id,
      campaign_title: campaignTitle,
      campaignTitle,
      session_id: session.id,
      sessionId: session.id,
      access_scope: 'campaign',
      accessScope: 'campaign',
      redirect: 'dashboard',
    });
  } catch (error) {
    console.error('[live-sessions/codes/join] failed:', error);
    return NextResponse.json({ error: 'Unable to join live session.' }, { status: 500 });
  }
}
