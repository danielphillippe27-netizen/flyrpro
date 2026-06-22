import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  resolveWorkspaceIdForUser,
  type MinimalSupabaseClient,
} from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';
import type { SalespersonLeadMaster } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SalespersonRow = {
  id: string;
  full_name: string;
  email: string;
  workspace_id: string | null;
};

type LeadListResponse = {
  leads: SalespersonLeadMaster[];
  workspaceId: string | null;
};

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function withListMetadata(row: SalespersonLeadMaster): SalespersonLeadMaster {
  const metadata = row.metadata && typeof row.metadata === 'object'
    ? row.metadata as Record<string, unknown>
    : {};

  return {
    ...row,
    list_id: readString(metadata.listId) ?? readString(metadata.list_id),
    list_name: readString(metadata.listName) ?? readString(metadata.list_name),
  };
}

async function resolveSalesperson(
  admin: ReturnType<typeof createAdminClient>,
  email: string | null
): Promise<SalespersonRow | null> {
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) return null;

  const { data, error } = await admin
    .from('salespeople')
    .select('id, full_name, email, workspace_id')
    .eq('email', normalizedEmail)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as SalespersonRow | null) ?? null;
}

async function isFounderUser(
  admin: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from('user_profiles')
    .select('user_id, is_founder')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return Boolean((data as { is_founder?: boolean | null } | null)?.is_founder);
}

async function resolveWorkspaceIdForLeads(params: {
  admin: ReturnType<typeof createAdminClient>;
  requestUser: { id: string };
  salesperson: SalespersonRow | null;
  requestedWorkspaceId?: string | null;
}): Promise<string | null> {
  if (params.requestedWorkspaceId) {
    const requestedResolution = await resolveWorkspaceIdForUser(
      params.admin as unknown as MinimalSupabaseClient,
      params.requestUser.id,
      params.requestedWorkspaceId
    );
    if (requestedResolution.workspaceId) return requestedResolution.workspaceId;
  }

  if (params.salesperson?.workspace_id) return params.salesperson.workspace_id;

  const resolution = await resolveWorkspaceIdForUser(
    params.admin as unknown as MinimalSupabaseClient,
    params.requestUser.id,
    params.requestedWorkspaceId ?? null
  );

  return resolution.workspaceId;
}

function isMissingMasterTable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown; details?: unknown };
  const text = `${String(candidate.message ?? '')} ${String(candidate.details ?? '')}`.toLowerCase();
  return candidate.code === '42P01' || text.includes('salesperson_lead_master');
}

export async function GET(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const requestedWorkspaceId = request.nextUrl.searchParams.get('workspaceId');

  try {
    const [salesperson, isFounder] = await Promise.all([
      resolveSalesperson(admin, requestUser.email),
      isFounderUser(admin, requestUser.id),
    ]);

    if (!salesperson && !isFounder) {
      return NextResponse.json(
        { error: 'Salesperson access is required for the leads list.' },
        { status: 403 }
      );
    }

    const workspaceId = await resolveWorkspaceIdForLeads({
      admin,
      requestUser,
      salesperson,
      requestedWorkspaceId,
    });

    if (!workspaceId) {
      return NextResponse.json({ leads: [], workspaceId: null } satisfies LeadListResponse);
    }

    let query = admin
      .from('salesperson_lead_master')
      .select(
        'id, workspace_id, contact_id, dialler_lead_id, assigned_user_id, assigned_salesperson_id, created_by_user_id, name, company, phone, phone_e164, email, email_normalized, website, website_domain, address, city, region, country_code, source, external_id, lead_fingerprint, lead_state, attempt_count, last_attempted_at, next_follow_up_at, disposition, notes, metadata, created_at, updated_at'
      )
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (salesperson?.id) {
      query = query.or(`assigned_user_id.eq.${requestUser.id},assigned_salesperson_id.eq.${salesperson.id}`);
    } else {
      query = query.eq('assigned_user_id', requestUser.id);
    }

    const { data, error } = await query.limit(500);
    if (error) {
      if (isMissingMasterTable(error)) {
        return NextResponse.json(
          { error: 'Lead master list is not ready yet. Run the latest Supabase migration.' },
          { status: 500 }
        );
      }
      throw error;
    }

    return NextResponse.json({
      leads: ((data ?? []) as SalespersonLeadMaster[]).map(withListMetadata),
      workspaceId,
    } satisfies LeadListResponse);
  } catch (error) {
    console.error('[api/salesperson/leads] GET error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load salesperson leads.' },
      { status: 500 }
    );
  }
}
