import { NextRequest, NextResponse } from 'next/server';
import { requestSupabase } from '@/app/api/_utils/request-supabase';

export const dynamic = 'force-dynamic';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get('workspaceId');
  if (!workspaceId || !uuid.test(workspaceId)) {
    return NextResponse.json({ error: 'A valid workspaceId is required' }, { status: 400 });
  }
  const client = await requestSupabase(request);
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data, error } = await client.rpc('get_workspace_coverage_settings', { p_workspace_id: workspaceId });
  if (error) return NextResponse.json({ error: 'Shared coverage settings are unavailable' }, { status: error.code === '42501' ? 403 : 503 });
  return NextResponse.json(data);
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.workspaceId !== 'string' || !uuid.test(body.workspaceId) || typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'workspaceId and a boolean enabled are required' }, { status: 400 });
  }
  const client = await requestSupabase(request);
  const { data: { user } } = await client.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data, error } = await client.rpc('set_workspace_coverage', { p_workspace_id: body.workspaceId, p_enabled: body.enabled });
  if (error) return NextResponse.json({ error: error.code === '42501' ? 'Only workspace owners and managers can change shared coverage' : 'Could not save shared coverage' }, { status: error.code === '42501' ? 403 : 503 });
  return NextResponse.json(data);
}
