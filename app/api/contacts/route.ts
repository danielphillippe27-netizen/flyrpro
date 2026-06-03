import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceIdForUser } from '@/app/api/_utils/workspace';
import type { MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ContactRow = {
  id: string;
  full_name?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  tags?: string[] | string | null;
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

function mapContact(row: ContactRow) {
  const tags = Array.isArray(row.tags)
    ? row.tags
    : typeof row.tags === 'string' && row.tags.trim()
      ? row.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
      : [];
  return {
    id: row.id,
    fullName: row.full_name || row.name || 'Contact',
    email: row.email ?? null,
    phone: row.phone ?? null,
    address: row.address ?? null,
    notes: row.notes ?? null,
    tags,
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
  const fullName = typeof body.fullName === 'string'
    ? body.fullName.trim()
    : typeof body.full_name === 'string'
      ? body.full_name.trim()
      : '';
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
  const payload: Record<string, unknown> = {
    user_id: requestUser.id,
    workspace_id: workspace.workspaceId,
    full_name: fullName,
    email: typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null,
    phone: typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null,
    status: 'new',
  };

  let insert = await admin.from('contacts').insert(payload).select('id, full_name, name, email, phone, address, notes, tags').single();
  if (insert.error && isMissingColumn(insert.error, 'workspace_id')) {
    delete payload.workspace_id;
    insert = await admin.from('contacts').insert(payload).select('id, full_name, name, email, phone, address, notes, tags').single();
  }
  if (insert.error) {
    return NextResponse.json({ error: insert.error.message }, { status: 500 });
  }

  return NextResponse.json(mapContact(insert.data as ContactRow), { status: 201 });
}
