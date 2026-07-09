import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  resolveDashboardAccessLevel,
  resolveWorkspaceIdForUser,
  type MinimalSupabaseClient,
} from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveSalespersonForUser } from '@/lib/dialer/salesperson-settings';
import type { SalesLead } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SalespersonRow = {
  id: string;
  user_id: string | null;
  full_name: string;
  email: string;
  status: string | null;
};

type WorkspaceMemberRow = {
  user_id: string;
  role: string | null;
};

type UserProfileRow = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
};

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
};

type MasterListMember = {
  id: string;
  salespersonId: string | null;
  userId: string | null;
  name: string;
  email: string | null;
  role: string | null;
  status: string | null;
};

type MasterListResponse = {
  leads: SalesLead[];
  members: MasterListMember[];
  workspaceId: string | null;
  total: number;
};

const LEAD_SELECT = `
  id,
  workspace_id,
  sales_contact_id,
  converted_contact_id,
  legacy_contact_id,
  legacy_dialler_lead_id,
  legacy_master_lead_id,
  assigned_user_id,
  assigned_sales_rep_id,
  created_by_user_id,
  name,
  company,
  phone,
  phone_e164,
  phone_country_code,
  phone_area_code,
  phone_area_label,
  email,
  email_normalized,
  list_id,
  list_name,
  website,
  website_domain,
  address,
  city,
  region,
  country_code,
  source,
  external_id,
  lead_fingerprint,
  lead_state,
  attempt_count,
  last_attempted_at,
  next_follow_up_at,
  follow_up_name,
  demo_link_follow_up_id,
  disposition,
  is_starred,
  notes,
  metadata,
  created_at,
  updated_at
`;

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function withListMetadata(row: SalesLead): SalesLead {
  const metadata = row.metadata && typeof row.metadata === 'object'
    ? row.metadata as Record<string, unknown>
    : {};

  return {
    ...row,
    list_id: readString(metadata.listId) ?? readString(metadata.list_id),
    list_name: readString(metadata.listName) ?? readString(metadata.list_name),
  };
}

function parseLimit(value: string | null): number {
  const parsed = Number(value ?? 10000);
  if (!Number.isFinite(parsed)) return 10000;
  return Math.min(Math.max(Math.trunc(parsed), 1), 25000);
}

function memberNameFromProfile(userProfile?: UserProfileRow, profile?: ProfileRow): string | null {
  const profileName = profile?.full_name?.trim();
  if (profileName) return profileName;

  const first = userProfile?.first_name?.trim() ?? '';
  const last = userProfile?.last_name?.trim() ?? '';
  const joined = [first, last].filter(Boolean).join(' ');
  return joined || null;
}

async function loadMembers(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string
): Promise<MasterListMember[]> {
  const [{ data: salespeople }, { data: workspaceMembers }] = await Promise.all([
    admin
      .from('salespeople')
      .select('id, user_id, full_name, email, status')
      .eq('workspace_id', workspaceId)
      .order('full_name', { ascending: true }),
    admin
      .from('workspace_members')
      .select('user_id, role')
      .eq('workspace_id', workspaceId),
  ]);

  const memberRows = (workspaceMembers ?? []) as WorkspaceMemberRow[];
  const userIds = Array.from(
    new Set(memberRows.map((row) => row.user_id).filter(Boolean))
  );

  const [userProfilesResult, profilesResult] = userIds.length > 0
    ? await Promise.all([
        admin
          .from('user_profiles')
          .select('user_id, first_name, last_name')
          .in('user_id', userIds),
        admin
          .from('profiles')
          .select('id, email, full_name')
          .in('id', userIds),
      ])
    : [{ data: [] }, { data: [] }];

  const userProfileById = new Map(
    ((userProfilesResult.data ?? []) as UserProfileRow[]).map((row) => [row.user_id, row])
  );
  const profileById = new Map(
    ((profilesResult.data ?? []) as ProfileRow[]).map((row) => [row.id, row])
  );
  const roleByUserId = new Map(memberRows.map((row) => [row.user_id, row.role]));
  const membersByKey = new Map<string, MasterListMember>();

  for (const salesperson of (salespeople ?? []) as SalespersonRow[]) {
    const userProfile = salesperson.user_id ? userProfileById.get(salesperson.user_id) : undefined;
    const profile = salesperson.user_id ? profileById.get(salesperson.user_id) : undefined;
    membersByKey.set(`salesperson:${salesperson.id}`, {
      id: `salesperson:${salesperson.id}`,
      salespersonId: salesperson.id,
      userId: salesperson.user_id,
      name: salesperson.full_name || memberNameFromProfile(userProfile, profile) || salesperson.email,
      email: salesperson.email || profile?.email || null,
      role: salesperson.user_id ? roleByUserId.get(salesperson.user_id) ?? null : null,
      status: salesperson.status,
    });
  }

  for (const member of memberRows) {
    const alreadyCovered = Array.from(membersByKey.values()).some(
      (row) => row.userId === member.user_id
    );
    if (alreadyCovered) continue;

    const profile = profileById.get(member.user_id);
    const userProfile = userProfileById.get(member.user_id);
    membersByKey.set(`user:${member.user_id}`, {
      id: `user:${member.user_id}`,
      salespersonId: null,
      userId: member.user_id,
      name: memberNameFromProfile(userProfile, profile) || profile?.email || 'Member',
      email: profile?.email ?? null,
      role: member.role,
      status: null,
    });
  }

  return Array.from(membersByKey.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export async function GET(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const requestedWorkspaceId = request.nextUrl.searchParams.get('workspaceId');
  const requestedMemberId = request.nextUrl.searchParams.get('memberId');
  const limit = parseLimit(request.nextUrl.searchParams.get('limit'));

  try {
    const access = await resolveDashboardAccessLevel(
      admin as unknown as MinimalSupabaseClient,
      requestUser.id,
      requestedWorkspaceId
    );

    let workspaceId = access.workspaceId;
    if (!workspaceId && access.isFounder) {
      const fallback = await resolveWorkspaceIdForUser(
        admin as unknown as MinimalSupabaseClient,
        requestUser.id,
        requestedWorkspaceId
      );
      workspaceId = fallback.workspaceId;
    }

    if (!workspaceId) {
      return NextResponse.json(
        { error: access.error ?? 'Workspace not found' },
        { status: access.status ?? 400 }
      );
    }

    const salesperson = await resolveSalespersonForUser(admin, {
      userId: requestUser.id,
      email: requestUser.email,
      workspaceId,
    });
    const canSeeWorkspaceMasterList = access.isFounder || Boolean(salesperson?.id);
    if (!canSeeWorkspaceMasterList) {
      return NextResponse.json(
        { error: 'Salesperson access is required.' },
        { status: 403 }
      );
    }

    const members = await loadMembers(admin, workspaceId);
    const selectedMember = requestedMemberId && requestedMemberId !== 'all'
      ? members.find((member) => member.id === requestedMemberId)
      : null;

    let query = admin
      .from('sales_leads')
      .select(LEAD_SELECT, { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (selectedMember?.userId) {
      query = query.eq('assigned_user_id', selectedMember.userId);
    } else if (selectedMember?.salespersonId) {
      const { data: salesRep } = await admin
        .from('sales_reps')
        .select('id')
        .eq('legacy_salesperson_id', selectedMember.salespersonId)
        .limit(1)
        .maybeSingle();
      query = query.eq('assigned_sales_rep_id', String((salesRep as { id?: unknown } | null)?.id ?? selectedMember.salespersonId));
    } else if (requestedMemberId && requestedMemberId !== 'all') {
      return NextResponse.json(
        { error: 'Selected member was not found in this workspace.' },
        { status: 400 }
      );
    }

    const { data, error, count } = await query;
    if (error) throw error;

    return NextResponse.json({
      leads: ((data ?? []) as SalesLead[]).map(withListMetadata),
      members,
      workspaceId,
      total: count ?? (data?.length ?? 0),
    } satisfies MasterListResponse);
  } catch (error) {
    console.error('[api/settings/master-list] GET error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load master list.' },
      { status: 500 }
    );
  }
}
