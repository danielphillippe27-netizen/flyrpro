import type { createAdminClient } from '@/lib/supabase/server';

function displayNameFromProfile(profile?: { first_name: string | null; last_name: string | null } | null): string {
  const displayName = [profile?.first_name, profile?.last_name]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ')
    .trim();
  return displayName || 'Member';
}

export async function loadTeamMembers(
  supabase: ReturnType<typeof createAdminClient>,
  workspaceId: string
) {
  const { data: memberRows, error } = await supabase
    .from('workspace_members')
    .select('user_id, color')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: true });

  if (error) throw error;

  const userIds = ((memberRows ?? []) as Array<{ user_id: string }>).map((row) => row.user_id);
  const { data: profiles, error: profilesError } = userIds.length
    ? await supabase
        .from('user_profiles')
        .select('user_id, first_name, last_name, avatar_url')
        .in('user_id', userIds)
    : { data: [] as Array<{ user_id: string; first_name: string | null; last_name: string | null; avatar_url?: string | null }>, error: null };

  if (profilesError) throw profilesError;

  const profileByUserId = new Map(
    ((profiles ?? []) as Array<{ user_id: string; first_name: string | null; last_name: string | null; avatar_url?: string | null }>).map(
      (profile) => [profile.user_id, profile]
    )
  );

  return ((memberRows ?? []) as Array<{ user_id: string; color: string | null }>).map((row) => ({
    user_id: row.user_id,
    display_name: displayNameFromProfile(profileByUserId.get(row.user_id)),
    color: row.color ?? '#3B82F6',
    avatar_url: profileByUserId.get(row.user_id)?.avatar_url ?? null,
  }));
}

export async function loadLivePresence(
  supabase: ReturnType<typeof createAdminClient>,
  workspaceId: string
) {
  const members = await loadTeamMembers(supabase, workspaceId);
  const memberByUserId = new Map(members.map((member) => [member.user_id, member]));

  const freshnessCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: presenceRows, error: presenceError } = await supabase
    .from('campaign_presence')
    // Filter through the campaign relationship instead of putting every campaign
    // ID in the URL, which exceeds gateway limits for established teams.
    .select('campaign_id, user_id, session_id, lat, lng, status, updated_at, campaigns!inner(workspace_id, title, name)')
    .eq('campaigns.workspace_id', workspaceId)
    .gte('updated_at', freshnessCutoff)
    .neq('status', 'inactive')
    .order('updated_at', { ascending: false });

  if (presenceError) throw presenceError;

  const validPresence = ((presenceRows ?? []) as Array<{
    campaign_id: string;
    campaigns: { workspace_id: string; title: string | null; name: string | null };
    user_id: string;
    session_id: string | null;
    lat: number | null;
    lng: number | null;
    status: string | null;
    updated_at: string | null;
  }>).filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng));

  const sessionIds = Array.from(
    new Set(validPresence.map((row) => row.session_id).filter((id): id is string => typeof id === 'string' && id.length > 0))
  );
  const { data: sessions, error: sessionsError } = sessionIds.length
    ? await supabase
        .from('sessions')
        .select('id, user_id, campaign_id, start_time, active_seconds, distance_meters, doors_hit, conversations, flyers_delivered')
        .eq('workspace_id', workspaceId)
        .is('end_time', null)
        .in('id', sessionIds)
    : { data: [] as Array<Record<string, unknown>>, error: null };

  if (sessionsError) throw sessionsError;

  const sessionById = new Map(((sessions ?? []) as Array<Record<string, unknown>>).map((session) => [String(session.id), session]));

  // Only surface agents who have a currently active (non-ended) session.
  // The presence write endpoint already requires a sessionId, so null means
  // legacy/test data — exclude it here too.
  // Rows arrive newest first. Keep one valid location per current team member,
  // even if an earlier campaign still has fresh presence for the same rep.
  const seenUsers = new Set<string>();
  const presenceWithActiveSession = validPresence.filter((row) => {
    if (!memberByUserId.has(row.user_id) || seenUsers.has(row.user_id)) return false;
    if (typeof row.session_id !== 'string' || !row.session_id || !sessionById.has(row.session_id)) return false;
    const session = sessionById.get(row.session_id)!;
    // Shared-session participants may use the host's session; match campaign,
    // not session.user_id, so those teammates remain visible.
    if (session.campaign_id !== row.campaign_id) return false;
    if (Math.abs(row.lat!) > 90 || Math.abs(row.lng!) > 180) return false;
    seenUsers.add(row.user_id);
    return true;
  });

  return {
    members,
    livePresence: presenceWithActiveSession.map((row) => {
      const member = memberByUserId.get(row.user_id);
      const campaign = row.campaigns;
      const session = row.session_id ? sessionById.get(row.session_id) : null;
      return {
        user_id: row.user_id,
        display_name: member?.display_name ?? 'Member',
        color: member?.color ?? '#3B82F6',
        avatar_url: member?.avatar_url ?? null,
        campaign_id: row.campaign_id,
        campaign_name: campaign?.title || campaign?.name || 'Campaign',
        session_id: row.session_id,
        lat: row.lat,
        lng: row.lng,
        status: row.status ?? 'active',
        updated_at: row.updated_at,
        started_at: typeof session?.start_time === 'string' ? session.start_time : null,
        active_seconds: Number(session?.active_seconds ?? 0) || 0,
        distance_meters: Number(session?.distance_meters ?? 0) || 0,
        doors_hit: Number(session?.doors_hit ?? 0) || 0,
        conversations: Number(session?.conversations ?? 0) || 0,
        flyers_delivered: Number(session?.flyers_delivered ?? 0) || 0,
      };
    }),
  };
}

