import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApprovedAmbassadorApi } from '@/app/lib/billing/ambassador-access';
import { sanitizeTrackingParam } from '@/app/lib/ambassador/portal';

const linkUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  source: z.string().trim().min(2).max(80),
  campaign: z.string().trim().min(2).max(80),
  destination: z.enum(['onboarding', 'landing_page']).optional(),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
});

function optionalString(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApprovedAmbassadorApi(request);
    if (!auth.ok) return auth.response;

    const { id } = await context.params;
    const body = await request.json().catch(() => null);
    const parsed = linkUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid link payload' },
        { status: 400 }
      );
    }

    const { admin, ambassador } = auth.context;
    const { error } = await admin
      .from('ambassador_links')
      .update({
        name: parsed.data.name.trim(),
        source: sanitizeTrackingParam(parsed.data.source) ?? parsed.data.source.trim(),
        campaign: sanitizeTrackingParam(parsed.data.campaign) ?? parsed.data.campaign.trim(),
        destination: 'landing_page',
        notes: optionalString(parsed.data.notes),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('ambassador_application_id', ambassador.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[api/ambassador/links/:id] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update ambassador link' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireApprovedAmbassadorApi(request);
    if (!auth.ok) return auth.response;

    const { id } = await context.params;
    const { admin, ambassador } = auth.context;
    const { error } = await admin
      .from('ambassador_links')
      .delete()
      .eq('id', id)
      .eq('ambassador_application_id', ambassador.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[api/ambassador/links/:id] DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete ambassador link' }, { status: 500 });
  }
}
