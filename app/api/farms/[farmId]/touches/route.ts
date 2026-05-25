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
  params: Promise<{ farmId: string }>;
};

type CreateTouchBody = {
  date?: string;
  type?: string;
  mode?: string;
  title?: string;
  notes?: string | null;
  campaignId?: string | null;
};

function dateOnly(value: unknown): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date().toISOString().slice(0, 10);
}

function defaultMode(type: string): string {
  if (type === 'door_knock') return 'doorknock';
  if (type === 'ad') return 'social_ad';
  if (type === 'newsletter') return 'letter';
  return type || 'flyer';
}

function normalizeTouch(row: Record<string, unknown>) {
  return {
    id: row.id,
    farmId: row.farm_id,
    cycleNumber: row.cycle_number ?? null,
    date: row.date ?? row.scheduled_date ?? row.created_at,
    type: row.type ?? 'flyer',
    mode: row.mode ?? defaultMode(String(row.type ?? 'flyer')),
    title: row.title ?? 'Farm Touch',
    notes: row.notes ?? null,
    orderIndex: row.order_index ?? null,
    completed: row.completed ?? false,
    campaignId: row.campaign_id ?? null,
    batchId: row.batch_id ?? null,
    sessionId: row.session_id ?? null,
    homesReached: row.homes_reached ?? null,
    completedAt: row.completed_at ?? row.completed_date ?? row.last_completed_at ?? null,
    completedByUserId: row.completed_by_user_id ?? null,
    executionMetrics: row.execution_metrics ?? {},
    createdAt: row.created_at ?? null,
  };
}

export async function GET(request: NextRequest, context: RouteContext) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { farmId } = await context.params;
  const admin = createAdminClient();
  const { farm } = await selectFarmCampaignRow(admin, farmId);
  if (!farm) return NextResponse.json({ error: 'Farm not found' }, { status: 404 });
  if (!(await userCanAccessFarm(admin, requestUser.id, farm))) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const { data, error } = await admin
    .from('farm_touches')
    .select('*')
    .eq('farm_id', farmId)
    .order('date', { ascending: true, nullsFirst: false })
    .order('order_index', { ascending: true, nullsFirst: false });

  if (error) return NextResponse.json({ error: formatApiError(error) }, { status: 500 });
  return NextResponse.json((data ?? []).map((row) => normalizeTouch(row as Record<string, unknown>)));
}

export async function POST(request: NextRequest, context: RouteContext) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { farmId } = await context.params;
  const admin = createAdminClient();
  const { farm } = await selectFarmCampaignRow(admin, farmId);
  if (!farm) return NextResponse.json({ error: 'Farm not found' }, { status: 404 });
  if (!(await userCanAccessFarm(admin, requestUser.id, farm))) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as CreateTouchBody;
  const type = typeof body.type === 'string' && body.type.trim() ? body.type.trim() : 'flyer';
  const mode = typeof body.mode === 'string' && body.mode.trim() ? body.mode.trim() : defaultMode(type);
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Farm Touch';

  const { data: siblingTouches } = await admin
    .from('farm_touches')
    .select('cycle_number, order_index')
    .eq('farm_id', farmId);
  const nextOrder = Math.max(-1, ...((siblingTouches ?? []).map((touch) => Number(touch.order_index ?? -1)))) + 1;
  const nextCycle = Math.max(0, ...((siblingTouches ?? []).map((touch) => Number(touch.cycle_number ?? 0)))) + 1;

  const insertPayload = {
    farm_id: farmId,
    workspace_id: (farm as { workspace_id?: string | null }).workspace_id ?? null,
    date: dateOnly(body.date),
    scheduled_date: dateOnly(body.date),
    type,
    mode,
    title,
    notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
    campaign_id: typeof body.campaignId === 'string' && body.campaignId.trim() ? body.campaignId.trim() : null,
    cycle_number: nextCycle,
    order_index: nextOrder,
    completed: false,
  };

  const { data, error } = await admin.from('farm_touches').insert(insertPayload).select().single();
  if (error || !data) {
    return NextResponse.json({ error: error ? formatApiError(error) : 'Failed to create touch' }, { status: 500 });
  }

  return NextResponse.json(normalizeTouch(data as Record<string, unknown>));
}
