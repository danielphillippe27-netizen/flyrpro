import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  LIVE_SESSION_CODE_TTL_MINUTES,
  hashLiveSessionCode,
  makeLiveSessionCode,
} from '@/app/api/live-sessions/_lib/live-session-codes';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CreateLiveSessionCodeBody = {
  session_id?: string;
  sessionId?: string;
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

function isUniqueViolation(error: DatabaseError | null | undefined): boolean {
  return error?.code === '23505' || errorText(error).includes('duplicate key');
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

    const body = (await request.json().catch(() => ({}))) as CreateLiveSessionCodeBody;
    const sessionId = body.session_id?.trim() || body.sessionId?.trim();
    if (!sessionId) {
      return NextResponse.json({ error: 'session_id is required.' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: sessionData, error: sessionError } = await admin
      .from('sessions')
      .select('id,user_id,campaign_id,workspace_id,end_time')
      .eq('id', sessionId)
      .maybeSingle();

    if (sessionError) {
      console.error('[live-sessions/codes/create] session lookup error:', sessionError);
      return NextResponse.json({ error: 'Unable to load live session.' }, { status: 500 });
    }

    const session = sessionData as SessionRow | null;
    if (!session) {
      return NextResponse.json({ error: 'Live session not found.' }, { status: 404 });
    }

    if (session.user_id !== requestUser.id) {
      return NextResponse.json(
        { error: 'Only the session host can create a join code.' },
        { status: 403 }
      );
    }

    if (session.end_time) {
      return NextResponse.json(
        { error: 'This live session has already ended. Start a new session to share a new code.' },
        { status: 400 }
      );
    }

    if (!session.campaign_id) {
      return NextResponse.json(
        { error: 'This session is not attached to a campaign.' },
        { status: 400 }
      );
    }

    const { data: campaignData, error: campaignError } = await admin
      .from('campaigns')
      .select('id,title,name,workspace_id')
      .eq('id', session.campaign_id)
      .maybeSingle();

    if (campaignError) {
      console.error('[live-sessions/codes/create] campaign lookup error:', campaignError);
      return NextResponse.json({ error: 'Unable to load campaign.' }, { status: 500 });
    }

    const campaign = campaignData as CampaignRow | null;
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found.' }, { status: 404 });
    }

    const nowIso = new Date().toISOString();
    const revokeResult = await admin
      .from('live_session_codes')
      .update({ revoked_at: nowIso })
      .eq('session_id', session.id)
      .is('revoked_at', null);

    if (revokeResult.error) {
      console.error('[live-sessions/codes/create] code revoke error:', revokeResult.error);
      if (isMissingRelation(revokeResult.error, 'live_session_codes')) {
        return NextResponse.json(
          { error: 'Live session codes are not live on the backend yet.' },
          { status: 500 }
        );
      }
      return NextResponse.json({ error: 'Unable to prepare a session code.' }, { status: 500 });
    }

    const expiresAt = new Date(Date.now() + LIVE_SESSION_CODE_TTL_MINUTES * 60 * 1000).toISOString();
    const maxAttempts = 8;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const code = makeLiveSessionCode();
      const { error: insertError } = await admin.from('live_session_codes').insert({
        session_id: session.id,
        campaign_id: campaign.id,
        workspace_id: campaign.workspace_id ?? session.workspace_id,
        created_by: requestUser.id,
        code_hash: hashLiveSessionCode(code),
        expires_at: expiresAt,
      });

      if (!insertError) {
        const workspaceId = campaign.workspace_id ?? session.workspace_id;
        const campaignTitle = campaign.title || campaign.name || 'Campaign';
        return NextResponse.json({
          success: true,
          code,
          expires_at: expiresAt,
          expiresAt,
          workspace_id: workspaceId,
          workspaceId,
          campaign_id: campaign.id,
          campaignId: campaign.id,
          campaign_title: campaignTitle,
          campaignTitle,
          session_id: session.id,
          sessionId: session.id,
        });
      }

      if (isUniqueViolation(insertError)) continue;

      console.error('[live-sessions/codes/create] code insert error:', insertError);
      if (isMissingRelation(insertError, 'live_session_codes')) {
        return NextResponse.json(
          { error: 'Live session codes are not live on the backend yet.' },
          { status: 500 }
        );
      }
      return NextResponse.json({ error: 'Unable to create a session code.' }, { status: 500 });
    }

    return NextResponse.json(
      { error: 'Unable to generate a unique session code. Please try again.' },
      { status: 500 }
    );
  } catch (error) {
    console.error('[live-sessions/codes/create] failed:', error);
    return NextResponse.json({ error: 'Unable to create a session code.' }, { status: 500 });
  }
}
