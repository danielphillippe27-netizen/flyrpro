import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApprovedAmbassadorApi } from '@/app/lib/billing/ambassador-access';
import { getOrCreateAmbassadorLandingPage } from '@/app/lib/ambassador/landing-page';
import { buildPublicLandingPath, withFlyrOrigin } from '@/app/lib/ambassador/portal';

const landingPageSchema = z.object({
  slug: z.string().trim().min(2).max(64).optional(),
  displayName: z.string().trim().max(120).optional().or(z.literal('')),
  headline: z.string().trim().max(160).optional().or(z.literal('')),
  introMessage: z.string().trim().max(600).optional().or(z.literal('')),
  mediaUrl: z.string().trim().url().max(500).optional().or(z.literal('')),
  profileImageUrl: z.string().trim().url().max(500).optional().or(z.literal('')),
  heroVideoUrl: z.string().trim().url().max(500).optional().or(z.literal('')),
  audienceType: z
    .enum(['real_estate', 'roofing', 'solar', 'coaching', 'other'])
    .optional()
    .or(z.literal('')),
  ctaText: z.string().trim().max(80).optional().or(z.literal('')),
  offerText: z.string().trim().max(240).optional().or(z.literal('')),
  isPublished: z.boolean(),
});

function optionalString(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function serializeLandingPage(row: Awaited<ReturnType<typeof getOrCreateAmbassadorLandingPage>>) {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    headline: row.headline,
    introMessage: row.intro_message,
    profileImageUrl: row.profile_image_url,
    heroVideoUrl: row.hero_video_url,
    audienceType: row.audience_type,
    ctaText: row.cta_text,
    offerText: row.offer_text,
    isPublished: row.is_published,
    publicUrl: withFlyrOrigin(buildPublicLandingPath(row.slug)),
  };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApprovedAmbassadorApi(request);
    if (!auth.ok) return auth.response;
    const { admin, ambassador } = auth.context;
    const row = await getOrCreateAmbassadorLandingPage(admin, ambassador);
    return NextResponse.json(serializeLandingPage(row));
  } catch (error) {
    console.error('[api/ambassador/landing-page] GET error:', error);
    return NextResponse.json({ error: 'Failed to load landing page settings' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApprovedAmbassadorApi(request);
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null);
    const parsed = landingPageSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid landing page settings' },
        { status: 400 }
      );
    }

    const { admin, ambassador } = auth.context;
    const current = await getOrCreateAmbassadorLandingPage(admin, ambassador);
    const mediaUrl = optionalString(parsed.data.mediaUrl || parsed.data.heroVideoUrl);

    const { data, error } = await admin
      .from('ambassador_landing_pages')
      .update({
        display_name: optionalString(parsed.data.displayName),
        headline: optionalString(parsed.data.headline),
        intro_message: optionalString(parsed.data.introMessage),
        profile_image_url: optionalString(parsed.data.profileImageUrl),
        hero_video_url: mediaUrl,
        audience_type: optionalString(parsed.data.audienceType),
        cta_text: optionalString(parsed.data.ctaText),
        offer_text: optionalString(parsed.data.offerText),
        is_published: parsed.data.isPublished,
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

    return NextResponse.json(serializeLandingPage(data));
  } catch (error) {
    console.error('[api/ambassador/landing-page] POST error:', error);
    const message = error instanceof Error ? error.message : 'Failed to save landing page settings';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
