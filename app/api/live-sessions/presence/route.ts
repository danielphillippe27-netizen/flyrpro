import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { ensureCampaignAccess } from '@/app/api/campaigns/_utils/access';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PresenceBody = {
  sessionId?: string;
  campaignId?: string;
  latitude?: number;
  longitude?: number;
  status?: string;
};

type PresenceRow = {
  user_id: string;
  session_id: string | null;
  lat: number | null;
  lng: number | null;
  status: string | null;
  updated_at: string | null;
};

function mapPresenceRows(rows: PresenceRow[], currentUserId: string) {
  return rows
    .filter((row) => row.user_id !== currentUserId)
    .filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng))
    .map((row) => ({
      userId: row.user_id,
      sessionId: row.session_id,
      latitude: Number(row.lat),
      longitude: Number(row.lng),
      status: row.status ?? 'active',
      updatedAt: row.updated_at,
    }));
}

async function readPresence(campaignId: string, currentUserId: string) {
  const admin = createAdminClient();
  const freshnessCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from('campaign_presence')
    .select('user_id, session_id, lat, lng, status, updated_at')
    .eq('campaign_id', campaignId)
    .gte('updated_at', freshnessCutoff)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('[live-sessions/presence] read error:', error);
    return { participants: [], error: 'Unable to load live session presence.' };
  }

  return {
    participants: mapPresenceRows((data ?? []) as PresenceRow[], currentUserId),
    error: null,
  };
}

export async function GET(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const campaignId = request.nextUrl.searchParams.get('campaignId')?.trim();
  if (!campaignId) {
    return NextResponse.json({ error: 'campaignId is required' }, { status: 400 });
  }

  const admin = createAdminClient();
  const allowed = await ensureCampaignAccess(admin, campaignId, requestUser.id);
  if (!allowed) {
    return NextResponse.json({ error: 'Campaign not found or access denied' }, { status: 404 });
  }

  const presence = await readPresence(campaignId, requestUser.id);
  if (presence.error) {
    return NextResponse.json({ success: false, participants: [], error: presence.error }, { status: 500 });
  }
  return NextResponse.json({ success: true, participants: presence.participants });
}

export async function POST(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as PresenceBody;
  const campaignId = body.campaignId?.trim();
  const sessionId = body.sessionId?.trim();
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  if (!campaignId || !sessionId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return NextResponse.json({ error: 'sessionId, campaignId, latitude, and longitude are required' }, { status: 400 });
  }

  const admin = createAdminClient();
  const allowed = await ensureCampaignAccess(admin, campaignId, requestUser.id);
  if (!allowed) {
    return NextResponse.json({ error: 'Campaign not found or access denied' }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  const status = body.status === 'paused' ? 'paused' : 'active';
  const { error } = await admin.from('campaign_presence').upsert(
    {
      campaign_id: campaignId,
      user_id: requestUser.id,
      session_id: sessionId,
      lat: latitude,
      lng: longitude,
      status,
      updated_at: nowIso,
    },
    { onConflict: 'campaign_id,user_id' }
  );

  if (error) {
    console.error('[live-sessions/presence] upsert error:', error);
    return NextResponse.json({ success: false, participants: [], error: 'Unable to publish presence.' }, { status: 500 });
  }

  await admin
    .from('session_participants')
    .update({ last_seen_at: nowIso, left_at: null })
    .eq('session_id', sessionId)
    .eq('user_id', requestUser.id);

  const presence = await readPresence(campaignId, requestUser.id);
  return NextResponse.json({
    success: true,
    participants: presence.participants,
    error: presence.error,
  });
}
