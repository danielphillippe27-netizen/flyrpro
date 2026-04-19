import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireFounderApi } from '@/app/api/admin/_utils/founder';

const ambassadorStatusSchema = z.object({
  status: z.enum(['applied', 'approved', 'rejected', 'paused']).optional(),
  reviewNotes: z.string().trim().max(2000).optional().or(z.literal('')),
});

function normalizeNotes(value?: string): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ applicationId: string }> }
) {
  try {
    const auth = await requireFounderApi();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { applicationId } = await context.params;
    if (!applicationId) {
      return NextResponse.json({ error: 'Application ID is required.' }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const parsed = ambassadorStatusSchema.safeParse(body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      return NextResponse.json(
        { error: firstIssue?.message ?? 'Invalid update payload.' },
        { status: 400 }
      );
    }

    const updates: Record<string, string | null> = {};
    if (parsed.data.status) {
      updates.status = parsed.data.status;
      if (parsed.data.status === 'approved') {
        updates.approved_at = new Date().toISOString();
        updates.rejected_at = null;
      } else if (parsed.data.status === 'rejected') {
        updates.rejected_at = new Date().toISOString();
      } else {
        updates.rejected_at = null;
      }
    }

    if (parsed.data.reviewNotes !== undefined) {
      updates.review_notes = normalizeNotes(parsed.data.reviewNotes);
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No changes provided.' }, { status: 400 });
    }

    const { data, error } = await auth.admin
      .from('ambassador_applications')
      .update(updates)
      .eq('id', applicationId)
      .select('id, status, review_notes, approved_at, rejected_at')
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'Application not found.' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      application: {
        id: data.id,
        status: data.status,
        reviewNotes: data.review_notes,
        approvedAt: data.approved_at,
        rejectedAt: data.rejected_at,
      },
    });
  } catch (error) {
    console.error('[api/admin/ambassadors/:applicationId] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
