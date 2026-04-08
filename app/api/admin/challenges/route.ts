import { NextResponse } from 'next/server';
import { requireFounderApi } from '@/app/api/admin/_utils/founder';
import { mapTemplateRow, type ChallengeTemplateRow } from '@/app/api/challenges/_lib';

/**
 * GET /api/admin/challenges
 * List all challenge templates (founder only).
 */
export async function GET() {
  const auth = await requireFounderApi();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { data, error } = await auth.admin
    .from('challenge_templates')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[admin/challenges] list', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as ChallengeTemplateRow[];
  return NextResponse.json({
    templates: rows.map((r) => mapTemplateRow(r, 0)),
  });
}
