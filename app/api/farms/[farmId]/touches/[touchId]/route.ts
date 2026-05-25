import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  formatApiError,
  selectFarmCampaignRow,
  userCanAccessFarm,
} from '@/app/api/farms/_utils/backingCampaign';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: Promise<{ farmId: string; touchId: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { farmId, touchId } = await context.params;
  const admin = createAdminClient();
  const { farm } = await selectFarmCampaignRow(admin, farmId);
  if (!farm) return NextResponse.json({ error: 'Farm not found' }, { status: 404 });
  if (!(await userCanAccessFarm(admin, requestUser.id, farm))) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { completed?: unknown; notes?: unknown };
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.completed === 'boolean') {
    updates.completed = body.completed;
    updates.completed_at = body.completed ? new Date().toISOString() : null;
    updates.completed_by_user_id = body.completed ? requestUser.id : null;
    updates.status = body.completed ? 'completed' : 'scheduled';
  }
  if (typeof body.notes === 'string') updates.notes = body.notes.trim() || null;

  if (Object.keys(updates).length === 1) {
    return NextResponse.json({ error: 'No touch updates provided' }, { status: 400 });
  }

  const { data, error } = await admin
    .from('farm_touches')
    .update(updates)
    .eq('id', touchId)
    .eq('farm_id', farmId)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error ? formatApiError(error) : 'Failed to update touch' }, { status: 500 });
  }

  return NextResponse.json(data);
}
