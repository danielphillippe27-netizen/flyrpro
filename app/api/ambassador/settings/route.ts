import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApprovedAmbassadorApi } from '@/app/lib/billing/ambassador-access';
import {
  getOrCreateAmbassadorLandingPage,
  resolveUniqueAmbassadorSlug,
} from '@/app/lib/ambassador/landing-page';
import { buildPublicLandingPath, normalizePartnerSlug, withFlyrOrigin } from '@/app/lib/ambassador/portal';

const settingsSchema = z.object({
  username: z.string().trim().min(2).max(64),
  displayName: z.string().trim().max(120).optional().or(z.literal('')),
});

function optionalString(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function serializeSettings(row: Awaited<ReturnType<typeof getOrCreateAmbassadorLandingPage>>) {
  return {
    username: row.slug,
    displayName: row.display_name,
    publicUrl: withFlyrOrigin(buildPublicLandingPath(row.slug)),
  };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApprovedAmbassadorApi(request);
    if (!auth.ok) return auth.response;

    const { admin, ambassador } = auth.context;
    const current = await getOrCreateAmbassadorLandingPage(admin, ambassador);
    return NextResponse.json(serializeSettings(current));
  } catch (error) {
    console.error('[api/ambassador/settings] GET error:', error);
    return NextResponse.json({ error: 'Failed to load ambassador settings' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApprovedAmbassadorApi(request);
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null);
    const parsed = settingsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid ambassador settings' },
        { status: 400 }
      );
    }

    const { admin, ambassador } = auth.context;
    const current = await getOrCreateAmbassadorLandingPage(admin, ambassador);
    const normalizedUsername = normalizePartnerSlug(parsed.data.username);
    const username =
      normalizedUsername === current.slug
        ? current.slug
        : await resolveUniqueAmbassadorSlug(admin, normalizedUsername, current.id);

    const { data, error } = await admin
      .from('ambassador_landing_pages')
      .update({
        slug: username,
        display_name: optionalString(parsed.data.displayName),
        updated_at: new Date().toISOString(),
      })
      .eq('id', current.id)
      .eq('ambassador_application_id', ambassador.id)
      .select(
        'id, ambassador_application_id, slug, display_name, headline, intro_message, profile_image_url, hero_video_url, audience_type, cta_text, offer_text, is_published, created_at, updated_at'
      )
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(serializeSettings(data));
  } catch (error) {
    console.error('[api/ambassador/settings] POST error:', error);
    const message = error instanceof Error ? error.message : 'Failed to save ambassador settings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
