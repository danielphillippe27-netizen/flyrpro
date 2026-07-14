import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type QrRow = {
  id: string;
  slug?: string | null;
  qr_url?: string | null;
  metadata?: Record<string, unknown> | null;
  scans?: number | null;
};

function isMissingRelation(error: { message?: string; details?: string | null }, relation: string) {
  const text = `${error.message ?? ''} ${error.details ?? ''}`.toLowerCase();
  return text.includes(relation.toLowerCase()) && (text.includes('does not exist') || text.includes('not find'));
}

function mapQr(row: QrRow) {
  const title = typeof row.metadata?.title === 'string' && row.metadata.title.trim()
    ? row.metadata.title.trim()
    : row.slug || row.qr_url || 'QR Code';
  const scanCount = typeof row.metadata?.scan_count === 'number'
    ? row.metadata.scan_count
    : Number(row.scans ?? 0) || 0;
  return {
    id: row.id,
    title,
    scanCount,
  };
}

function randomSlug() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 10);
}

export async function GET(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const workspaceId = request.nextUrl.searchParams.get('workspaceId')?.trim() || null;
  let query = admin
    .from('qr_codes')
    .select('id, slug, qr_url, metadata, scans, created_at')
    .contains('metadata', { owner_user_id: requestUser.id })
    .order('created_at', { ascending: false })
    .limit(200);
  if (workspaceId) query = query.contains('metadata', { workspace_id: workspaceId });
  const { data, error } = await query;

  if (error) {
    if (isMissingRelation(error, 'qr_codes')) return NextResponse.json([]);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(((data ?? []) as QrRow[]).map(mapQr));
}

export async function POST(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'QR Code';
  const workspaceId = typeof body.workspaceId === 'string' && body.workspaceId.trim()
    ? body.workspaceId.trim()
    : null;
  const slug = randomSlug();
  const qrUrl = `/q/${slug}`;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('qr_codes')
    .insert({
      slug,
      qr_url: qrUrl,
      destination_type: 'directLink',
      direct_url: 'https://wolfgrid.app',
      metadata: {
        title,
        owner_user_id: requestUser.id,
        workspace_id: workspaceId,
        source: 'android',
      },
    })
    .select('id, slug, qr_url, metadata, scans')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(mapQr(data as QrRow), { status: 201 });
}
