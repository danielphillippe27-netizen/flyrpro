import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceIdForUser } from '@/app/api/_utils/workspace';
import type { MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';
import { pushLeadToConnectedCrms, type CrmPushResult } from '@/lib/integrations/auto-push';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ContactRow = {
  id: string;
  user_id?: string | null;
  full_name?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  workspace_id?: string | null;
  campaign_id?: string | null;
  farm_id?: string | null;
  status?: string | null;
  source?: string | null;
  last_contacted?: string | null;
  notes?: string | null;
  reminder_date?: string | null;
  follow_up_at?: string | null;
  appointment_at?: string | null;
  gers_id?: string | null;
  address_id?: string | null;
  tags?: string[] | string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function isMissingRelation(error: { message?: string; details?: string | null }, relation: string) {
  const text = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase();
  return text.includes(relation.toLowerCase()) && (text.includes('does not exist') || text.includes('not find'));
}

function isMissingColumn(error: unknown, column: string) {
  if (!error || typeof error !== 'object') return false;
  const text = `${(error as { message?: string }).message ?? ''} ${(error as { details?: string | null }).details ?? ''}`.toLowerCase();
  return text.includes(column.toLowerCase()) && (text.includes('does not exist') || text.includes('not find') || text.includes('column'));
}

function getErrorMessage(error: unknown, fallback = 'Unknown error') {
  if (!error) return fallback;
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object') {
    const candidate = error as { message?: unknown; details?: unknown; hint?: unknown };
    const parts = [candidate.message, candidate.details, candidate.hint]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0);
    if (parts.length > 0) return parts.join(' ');
  }
  return fallback;
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getOptionalIsoString(value: unknown): string | null {
  const candidate = getString(value);
  if (!candidate) return null;
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildFullName(body: Record<string, unknown>): string {
  const explicitName = getString(body.fullName) ?? getString(body.full_name);
  if (explicitName) return explicitName;

  const firstName = getString(body.first_name);
  const lastName = getString(body.last_name);
  return [firstName, lastName].filter(Boolean).join(' ').trim();
}

function mapContact(row: ContactRow) {
  const tags = Array.isArray(row.tags)
    ? row.tags
    : typeof row.tags === 'string' && row.tags.trim()
      ? row.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
      : [];
  return {
    id: row.id,
    user_id: row.user_id ?? '',
    full_name: row.full_name || row.name || 'Contact',
    fullName: row.full_name || row.name || 'Contact',
    email: row.email ?? null,
    phone: row.phone ?? null,
    address: row.address ?? '',
    workspace_id: row.workspace_id ?? null,
    campaign_id: row.campaign_id ?? undefined,
    farm_id: row.farm_id ?? undefined,
    status: row.status ?? 'new',
    source: row.source ?? undefined,
    last_contacted: row.last_contacted ?? undefined,
    notes: row.notes ?? null,
    reminder_date: row.reminder_date ?? undefined,
    follow_up_at: row.follow_up_at ?? undefined,
    appointment_at: row.appointment_at ?? undefined,
    gers_id: row.gers_id ?? undefined,
    address_id: row.address_id ?? undefined,
    tags: tags.join(', '),
    created_at: row.created_at ?? new Date().toISOString(),
    updated_at: row.updated_at ?? row.created_at ?? new Date().toISOString(),
  };
}

export async function GET(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const requestedWorkspaceId = request.nextUrl.searchParams.get('workspaceId')?.trim() || null;
  const workspace = await resolveWorkspaceIdForUser(
    admin as unknown as MinimalSupabaseClient,
    requestUser.id,
    requestedWorkspaceId
  );

  let query = admin
    .from('contacts')
    .select('id, full_name, name, email, phone, address, notes, tags, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  query = workspace.workspaceId ? query.eq('workspace_id', workspace.workspaceId) : query.eq('user_id', requestUser.id);

  const { data, error } = await query;
  if (error) {
    if (isMissingRelation(error, 'contacts')) return NextResponse.json([]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(((data ?? []) as ContactRow[]).map(mapContact));
}

export async function POST(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const fullName = buildFullName(body as Record<string, unknown>);
  if (!fullName) {
    return NextResponse.json({ error: 'fullName is required' }, { status: 400 });
  }

  const admin = createAdminClient();
  const requestedWorkspaceId = typeof body.workspaceId === 'string' && body.workspaceId.trim()
    ? body.workspaceId.trim()
    : null;
  const workspace = await resolveWorkspaceIdForUser(
    admin as unknown as MinimalSupabaseClient,
    requestUser.id,
    requestedWorkspaceId
  );
  if (requestedWorkspaceId && workspace.error) {
    return NextResponse.json({ error: workspace.error }, { status: workspace.status ?? 403 });
  }

  let linkedAddress: { gers_id?: string | null; campaign_id?: string | null; address?: string | null } | null = null;
  const addressId = getString(body.address_id);
  if (addressId) {
    const { data, error } = await admin
      .from('campaign_addresses')
      .select('gers_id, campaign_id, address')
      .eq('id', addressId)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: `Failed to fetch linked address: ${error.message}` }, { status: 500 });
    }
    linkedAddress = data;
  }

  const payload: Record<string, unknown> = {
    user_id: requestUser.id,
    workspace_id: workspace.workspaceId ?? null,
    full_name: fullName,
    email: getString(body.email),
    phone: getString(body.phone),
    address: getString(body.address) ?? linkedAddress?.address ?? '',
    campaign_id: getString(body.campaign_id) ?? linkedAddress?.campaign_id ?? null,
    farm_id: getString(body.farm_id),
    status: getString(body.status) ?? 'new',
    source: getString(body.source),
    last_contacted: getOptionalIsoString(body.last_contacted),
    notes: getString(body.notes),
    follow_up_at: getOptionalIsoString(body.follow_up_at),
    appointment_at: getOptionalIsoString(body.appointment_at),
    tags: getString(body.tags),
    address_id: addressId,
    gers_id: linkedAddress?.gers_id ?? null,
  };

  let insert = await admin.from('contacts').insert(payload).select('*').single();
  const removableColumns = [
    'workspace_id',
    'source',
    'last_contacted',
    'follow_up_at',
    'appointment_at',
    'tags',
    'address_id',
    'gers_id',
    'farm_id',
  ];
  const removedColumns = new Set<string>();

  while (insert.error) {
    const missingColumn = removableColumns.find(
      (column) => !removedColumns.has(column) && isMissingColumn(insert.error, column)
    );
    if (!missingColumn) break;

    removedColumns.add(missingColumn);
    delete payload[missingColumn];
    insert = await admin.from('contacts').insert(payload).select('*').single();
  }

  if (insert.error) {
    return NextResponse.json({ error: getErrorMessage(insert.error, 'Failed to create contact') }, { status: 500 });
  }

  const savedContact = insert.data as ContactRow;

  // Auto-push to connected CRMs immediately after save
  let crmSync: CrmPushResult[] = [];
  if (workspace.workspaceId) {
    try {
      crmSync = await pushLeadToConnectedCrms(admin, requestUser.id, workspace.workspaceId, {
        id: savedContact.id,
        full_name: savedContact.full_name ?? null,
        phone: savedContact.phone ?? null,
        email: savedContact.email ?? null,
        address: savedContact.address ?? null,
        notes: savedContact.notes ?? null,
        campaign_id: savedContact.campaign_id ?? null,
      });
    } catch (err) {
      console.warn('[api/contacts] CRM auto-push failed', err);
    }
  }

  return NextResponse.json({ ...mapContact(savedContact), crmSync }, { status: 201 });
}
