import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireApprovedAmbassadorApi } from '@/app/lib/billing/ambassador-access';
import {
  buildPublicLandingPath,
  sanitizeTrackingParam,
  withFlyrOrigin,
} from '@/app/lib/ambassador/portal';
import { getOrCreateAmbassadorLandingPage } from '@/app/lib/ambassador/landing-page';
import { isMissingAmbassadorSchemaError, type SupabaseAdmin } from '@/app/lib/billing/ambassador-program';

const linkSchema = z.object({
  name: z.string().trim().min(2).max(120),
  source: z.string().trim().min(2).max(80),
  campaign: z.string().trim().min(2).max(80),
  destination: z.enum(['onboarding', 'landing_page']).default('landing_page'),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
});

type AmbassadorLinkRow = {
  id: string;
  name: string;
  source: string;
  campaign: string;
  destination: 'onboarding' | 'landing_page';
  notes: string | null;
  created_at: string;
};

function optionalString(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

async function countClicksForLink(
  admin: SupabaseAdmin,
  ambassadorApplicationId: string,
  source: string,
  campaign: string
): Promise<number> {
  const { count, error } = await admin
    .from('ambassador_click_events')
    .select('id', { count: 'exact', head: true })
    .eq('ambassador_application_id', ambassadorApplicationId)
    .eq('source', source)
    .eq('campaign', campaign);

  if (error) {
    if (isMissingAmbassadorSchemaError(error.message)) return 0;
    throw new Error(error.message);
  }
  return count ?? 0;
}

async function countReferralsForLink(
  admin: SupabaseAdmin,
  ambassadorApplicationId: string,
  source: string,
  campaign: string,
  paidOnly = false
): Promise<number> {
  let query = admin
    .from('ambassador_referrals')
    .select('id', { count: 'exact', head: true })
    .eq('ambassador_application_id', ambassadorApplicationId)
    .eq('source', source)
    .eq('campaign', campaign);

  if (paidOnly) {
    query = query.eq('status', 'active');
  }

  const { count, error } = await query;

  if (error) {
    if (isMissingAmbassadorSchemaError(error.message)) return 0;
    throw new Error(error.message);
  }

  return count ?? 0;
}

async function serializeLink(params: {
  admin: SupabaseAdmin;
  row: AmbassadorLinkRow;
  ambassadorApplicationId: string;
  landingSlug: string;
}) {
  const source = sanitizeTrackingParam(params.row.source) ?? params.row.source;
  const campaign = sanitizeTrackingParam(params.row.campaign) ?? params.row.campaign;
  const generatedPath = buildPublicLandingPath(params.landingSlug, source, campaign);
  const [clickCount, signupCount, paidCustomerCount] = await Promise.all([
    countClicksForLink(
      params.admin,
      params.ambassadorApplicationId,
      source,
      campaign
    ),
    countReferralsForLink(
      params.admin,
      params.ambassadorApplicationId,
      source,
      campaign
    ),
    countReferralsForLink(
      params.admin,
      params.ambassadorApplicationId,
      source,
      campaign,
      true
    ),
  ]);

  return {
    id: params.row.id,
    name: params.row.name,
    source: params.row.source,
    campaign: params.row.campaign,
    destination: 'landing_page',
    generatedUrl: withFlyrOrigin(generatedPath),
    clickCount,
    signupCount,
    paidCustomerCount,
    notes: params.row.notes,
    createdAt: params.row.created_at,
  };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireApprovedAmbassadorApi(request);
    if (!auth.ok) return auth.response;

    const { admin, ambassador } = auth.context;
    const landingPage = await getOrCreateAmbassadorLandingPage(admin, {
      ...ambassador,
    });

    const { data, error } = await admin
      .from('ambassador_links')
      .select('id, name, source, campaign, destination, notes, created_at')
      .eq('ambassador_application_id', ambassador.id)
      .order('created_at', { ascending: false });

    if (error) {
      if (isMissingAmbassadorSchemaError(error.message)) {
        return NextResponse.json({ links: [] });
      }
      throw new Error(error.message);
    }

    const links = await Promise.all(
      ((data ?? []) as AmbassadorLinkRow[]).map((row) =>
        serializeLink({
          admin,
          row,
          ambassadorApplicationId: ambassador.id,
          landingSlug: landingPage.slug,
        })
      )
    );

    return NextResponse.json({ links });
  } catch (error) {
    console.error('[api/ambassador/links] GET error:', error);
    return NextResponse.json({ error: 'Failed to load ambassador links' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApprovedAmbassadorApi(request);
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null);
    const parsed = linkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid link payload' },
        { status: 400 }
      );
    }

    const { admin, ambassador } = auth.context;
    const { data, error } = await admin
      .from('ambassador_links')
      .insert({
        ambassador_application_id: ambassador.id,
        name: parsed.data.name.trim(),
        source: sanitizeTrackingParam(parsed.data.source) ?? parsed.data.source.trim(),
        campaign: sanitizeTrackingParam(parsed.data.campaign) ?? parsed.data.campaign.trim(),
        destination: 'landing_page',
        notes: optionalString(parsed.data.notes),
      })
      .select('id, name, source, campaign, destination, notes, created_at')
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const landingPage = await getOrCreateAmbassadorLandingPage(admin, {
      ...ambassador,
    });

    return NextResponse.json({
      link: await serializeLink({
        admin,
        row: data as AmbassadorLinkRow,
        ambassadorApplicationId: ambassador.id,
        landingSlug: landingPage.slug,
      }),
    });
  } catch (error) {
    console.error('[api/ambassador/links] POST error:', error);
    return NextResponse.json({ error: 'Failed to create ambassador link' }, { status: 500 });
  }
}
