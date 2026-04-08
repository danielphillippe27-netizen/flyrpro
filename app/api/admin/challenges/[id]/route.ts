import { NextRequest, NextResponse } from 'next/server';
import { requireFounderApi } from '@/app/api/admin/_utils/founder';
import { mapTemplateRow, type ChallengeTemplateRow } from '@/app/api/challenges/_lib';

type PatchBody = {
  title?: string;
  description?: string;
  status?: 'upcoming' | 'active' | 'completed' | 'archived';
  duration_days?: number;
  metric_label_override?: string | null;
  target_audience?: string | null;
};

/**
 * PATCH /api/admin/challenges/:id
 * Update a challenge template (founder only).
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireFounderApi();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { id } = await context.params;
  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.title === 'string') updates.title = body.title.slice(0, 500);
  if (typeof body.description === 'string') updates.description = body.description.slice(0, 4000);
  if (
    body.status === 'upcoming' ||
    body.status === 'active' ||
    body.status === 'completed' ||
    body.status === 'archived'
  ) {
    updates.status = body.status;
  }
  if (typeof body.duration_days === 'number' && body.duration_days > 0 && body.duration_days < 400) {
    updates.duration_days = Math.floor(body.duration_days);
  }
  if (body.metric_label_override !== undefined) {
    updates.metric_label_override =
      typeof body.metric_label_override === 'string' ? body.metric_label_override.slice(0, 120) : null;
  }
  if (body.target_audience !== undefined) {
    updates.target_audience =
      typeof body.target_audience === 'string' ? body.target_audience.slice(0, 500) : null;
  }

  if (Object.keys(updates).length <= 1) {
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
  }

  const { data, error } = await auth.admin
    .from('challenge_templates')
    .update(updates)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('[admin/challenges] patch', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ template: mapTemplateRow(data as ChallengeTemplateRow, 0) });
}
