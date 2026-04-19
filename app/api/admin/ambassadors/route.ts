import { NextRequest, NextResponse } from 'next/server';
import { requireFounderApi } from '@/app/api/admin/_utils/founder';

type AmbassadorApplicationRow = {
  id: string;
  created_at: string;
  updated_at: string;
  full_name: string;
  email: string;
  phone: string | null;
  city: string | null;
  primary_niche: string;
  primary_platform: string;
  audience_size: string | null;
  instagram_handle: string | null;
  tiktok_handle: string | null;
  youtube_handle: string | null;
  website_url: string | null;
  audience_summary: string | null;
  why_flyr: string;
  promotion_plan: string | null;
  status: 'applied' | 'approved' | 'rejected' | 'paused';
  review_notes: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  stripe_connect_account_id: string | null;
  stripe_onboarding_completed: boolean;
  stripe_details_submitted: boolean;
  stripe_charges_enabled: boolean;
  stripe_payouts_enabled: boolean;
};

const SELECT_FIELDS = `
  id,
  created_at,
  updated_at,
  full_name,
  email,
  phone,
  city,
  primary_niche,
  primary_platform,
  audience_size,
  instagram_handle,
  tiktok_handle,
  youtube_handle,
  website_url,
  audience_summary,
  why_flyr,
  promotion_plan,
  status,
  review_notes,
  approved_at,
  rejected_at,
  stripe_connect_account_id,
  stripe_onboarding_completed,
  stripe_details_submitted,
  stripe_charges_enabled,
  stripe_payouts_enabled
`;

function parseLimit(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}

function isMissingRelationError(message: string | undefined): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return (
    normalized.includes('could not find the table') ||
    (normalized.includes('relation') && normalized.includes('does not exist'))
  );
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireFounderApi();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(request.url);
    const limit = parseLimit(searchParams.get('limit'), 25, 100);

    const [applicationsRes, appliedCountRes, approvedCountRes, payoutsReadyCountRes] =
      await Promise.all([
        auth.admin
          .from('ambassador_applications')
          .select(SELECT_FIELDS)
          .order('created_at', { ascending: false })
          .limit(limit),
        auth.admin
          .from('ambassador_applications')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'applied'),
        auth.admin
          .from('ambassador_applications')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'approved'),
        auth.admin
          .from('ambassador_applications')
          .select('id', { count: 'exact', head: true })
          .eq('stripe_payouts_enabled', true),
      ]);

    const possibleErrors = [
      applicationsRes.error,
      appliedCountRes.error,
      approvedCountRes.error,
      payoutsReadyCountRes.error,
    ].filter(Boolean);

    const missingRelation = possibleErrors.some((error) =>
      isMissingRelationError(error?.message)
    );

    if (missingRelation) {
      return NextResponse.json({
        setupRequired: true,
        kpis: {
          applied: 0,
          approved: 0,
          payoutsReady: 0,
        },
        applications: [],
      });
    }

    const firstError = possibleErrors[0];
    if (firstError) {
      return NextResponse.json({ error: firstError.message }, { status: 500 });
    }

    const applications = ((applicationsRes.data ?? []) as AmbassadorApplicationRow[]).map(
      (row) => ({
        id: row.id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        fullName: row.full_name,
        email: row.email,
        phone: row.phone,
        city: row.city,
        primaryNiche: row.primary_niche,
        primaryPlatform: row.primary_platform,
        audienceSize: row.audience_size,
        instagramHandle: row.instagram_handle,
        tiktokHandle: row.tiktok_handle,
        youtubeHandle: row.youtube_handle,
        websiteUrl: row.website_url,
        audienceSummary: row.audience_summary,
        whyFlyr: row.why_flyr,
        promotionPlan: row.promotion_plan,
        status: row.status,
        reviewNotes: row.review_notes,
        approvedAt: row.approved_at,
        rejectedAt: row.rejected_at,
        stripeConnectAccountId: row.stripe_connect_account_id,
        stripeOnboardingCompleted: row.stripe_onboarding_completed,
        stripeDetailsSubmitted: row.stripe_details_submitted,
        stripeChargesEnabled: row.stripe_charges_enabled,
        stripePayoutsEnabled: row.stripe_payouts_enabled,
      })
    );

    return NextResponse.json({
      setupRequired: false,
      kpis: {
        applied: appliedCountRes.count ?? 0,
        approved: approvedCountRes.count ?? 0,
        payoutsReady: payoutsReadyCountRes.count ?? 0,
      },
      applications,
    });
  } catch (error) {
    console.error('[api/admin/ambassadors] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
