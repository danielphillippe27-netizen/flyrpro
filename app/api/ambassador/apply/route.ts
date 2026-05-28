import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUniqueAmbassadorSlug } from '@/app/lib/ambassador/landing-page';
import { AMBASSADOR_LANDING_DEFAULTS, normalizePartnerSlug } from '@/app/lib/ambassador/portal';

const ambassadorApplicationSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  username: z.string().trim().min(2).max(64),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  city: z.string().trim().max(120).optional().or(z.literal('')),
  primaryNiche: z.string().trim().min(2).max(120),
  primaryPlatform: z.string().trim().min(2).max(40),
  audienceSize: z.string().trim().max(80).optional().or(z.literal('')),
  instagramHandle: z.string().trim().max(80).optional().or(z.literal('')),
  tiktokHandle: z.string().trim().max(80).optional().or(z.literal('')),
  youtubeHandle: z.string().trim().max(120).optional().or(z.literal('')),
  websiteUrl: z.string().trim().url().max(300).optional().or(z.literal('')),
  audienceSummary: z.string().trim().max(500).optional().or(z.literal('')),
  whyFlyr: z.string().trim().min(20).max(1500),
  promotionPlan: z.string().trim().max(1000).optional().or(z.literal('')),
});

function normalizeOptional(value?: string): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = ambassadorApplicationSchema.safeParse(body);

    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      return NextResponse.json(
        { error: firstIssue?.message ?? 'Invalid ambassador application.' },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const payload = parsed.data;
    const normalizedEmail = payload.email.trim().toLowerCase();
    const username = await resolveUniqueAmbassadorSlug(
      admin,
      normalizePartnerSlug(payload.username)
    );

    const { data: application, error } = await admin.from('ambassador_applications').insert({
      full_name: payload.fullName.trim(),
      email: normalizedEmail,
      phone: normalizeOptional(payload.phone),
      city: normalizeOptional(payload.city),
      primary_niche: payload.primaryNiche.trim(),
      primary_platform: payload.primaryPlatform.trim(),
      audience_size: normalizeOptional(payload.audienceSize),
      instagram_handle: normalizeOptional(payload.instagramHandle),
      tiktok_handle: normalizeOptional(payload.tiktokHandle),
      youtube_handle: normalizeOptional(payload.youtubeHandle),
      website_url: normalizeOptional(payload.websiteUrl),
      audience_summary: normalizeOptional(payload.audienceSummary),
      why_flyr: payload.whyFlyr.trim(),
      promotion_plan: normalizeOptional(payload.promotionPlan),
    }).select('id, full_name').single();

    if (error) {
      console.error('[api/ambassador/apply] insert error:', error);
      return NextResponse.json(
        { error: 'Could not save your application right now. Please try again shortly.' },
        { status: 500 }
      );
    }

    const { error: landingPageError } = await admin.from('ambassador_landing_pages').insert({
      ambassador_application_id: application.id,
      slug: username,
      display_name: application.full_name,
      headline: AMBASSADOR_LANDING_DEFAULTS.headline,
      intro_message: AMBASSADOR_LANDING_DEFAULTS.subline,
      cta_text: AMBASSADOR_LANDING_DEFAULTS.ctaText,
      offer_text: AMBASSADOR_LANDING_DEFAULTS.offerText,
    });

    if (landingPageError) {
      console.error('[api/ambassador/apply] landing page insert error:', landingPageError);
      return NextResponse.json(
        { error: 'Could not reserve that username. Please try another one.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Application received. We'll review it and reach out with next steps.",
    });
  } catch (error) {
    console.error('[api/ambassador/apply] unexpected error:', error);
    return NextResponse.json(
      { error: 'Unexpected error while submitting application.' },
      { status: 500 }
    );
  }
}
