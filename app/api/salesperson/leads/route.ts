import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  resolveWorkspaceIdForUser,
  type MinimalSupabaseClient,
} from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';
import type { SalesLead } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SalespersonRow = {
  id: string;
  full_name: string;
  email: string;
  workspace_id: string | null;
};

type LeadListResponse = {
  leads: SalesLead[];
  workspaceId: string | null;
};

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
      .from('sales_leads')
      .select(
        'id, workspace_id, sales_contact_id, converted_contact_id, legacy_contact_id, legacy_dialler_lead_id, legacy_master_lead_id, assigned_user_id, assigned_sales_rep_id, created_by_user_id, name, company, phone, phone_e164, email, email_normalized, list_id, list_name, website, website_domain, address, city, region, country_code, source, external_id, lead_fingerprint, lead_state, attempt_count, last_attempted_at, next_follow_up_at, follow_up_name, demo_link_follow_up_id, disposition, is_starred, notes, metadata, created_at, updated_at'
      )
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (salesperson?.id) {
      // Salesperson: scope to their own assigned leads only
      query = query.eq('assigned_user_id', requestUser.id);
    } else if (!isFounder) {
      // Non-salesperson, non-founder: shouldn't reach here (blocked above), but be safe
      query = query.eq('assigned_user_id', requestUser.id);
    }
    // Founder with no salesperson row: no additional filter → all workspace leads

    const { data, error } = await query.limit(2000);
    if (error) throw error;

    return NextResponse.json({
      leads: ((data ?? []) as SalesLead[]).map(withListMetadata),
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
