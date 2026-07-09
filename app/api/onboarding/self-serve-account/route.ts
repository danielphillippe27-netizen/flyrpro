import { after, NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/server';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/supabase/env';
import { normalizeCountryCode } from '@/lib/countries';

const SELF_SERVE_CAMPAIGN_NAME = 'FIRST CAMPAIGN';

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isDuplicateUserError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { message?: string; code?: string; status?: number };
  const message = candidate.message?.toLowerCase() ?? '';
  return (
    candidate.status === 422 ||
    candidate.code === 'email_exists' ||
    message.includes('already registered') ||
    message.includes('already exists') ||
    message.includes('duplicate')
  );
}

function isTransientAuthServiceError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    message?: string;
    code?: string;
    cause?: { code?: string; message?: string };
  };
  const message = `${candidate.message ?? ''} ${candidate.cause?.message ?? ''}`.toLowerCase();
  return (
    candidate.code === 'ERR_HTTP2_INVALID_SESSION' ||
    candidate.cause?.code === 'ERR_HTTP2_INVALID_SESSION' ||
    message.includes('fetch failed') ||
    message.includes('session has been destroyed')
  );
}

function authServiceUnavailableResponse() {
  return NextResponse.json(
    { error: 'Could not reach authentication service. Please try again.' },
    { status: 503 }
  );
}

function isFiniteNumberArray(value: unknown, expectedLength: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === expectedLength &&
    value.every((item) => typeof item === 'number' && Number.isFinite(item))
  );
}

function normalizeSelfServeCampaignDraft(value: unknown): {
  name: string | null;
  polygon: GeoJSON.Polygon;
  bbox: number[] | null;
} | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { name?: unknown; polygon?: unknown; bbox?: unknown };
  const polygon = candidate.polygon as GeoJSON.Polygon | null;
  if (
    !polygon ||
    polygon.type !== 'Polygon' ||
    !Array.isArray(polygon.coordinates) ||
    polygon.coordinates.length === 0
  ) {
    return null;
  }

  const hasUsableRing = polygon.coordinates.some(
    (ring) =>
      Array.isArray(ring) &&
      ring.length >= 4 &&
      ring.every((point) => isFiniteNumberArray(point, 2))
  );
  if (!hasUsableRing) return null;

  return {
    name: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name.trim() : null,
    polygon,
    bbox: isFiniteNumberArray(candidate.bbox, 4) ? candidate.bbox : null,
  };
}

async function findUnconfirmedUserByEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string
) {
  for (let page = 1; page <= 5; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) return null;
    const match = data.users.find(
      (user) => user.email?.trim().toLowerCase() === email
    );
    if (match) {
      return match.email_confirmed_at ? null : match;
    }
    if (data.users.length < 200) return null;
  }
  return null;
}

async function ensureWorkspaceForUser(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  fallbackName: string
): Promise<string> {
  const { data: existingMembership } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .eq('role', 'owner')
    .order('joined_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existingMembership?.workspace_id) return existingMembership.workspace_id;

  const { data: workspace, error: workspaceError } = await admin
    .from('workspaces')
    .insert({
      name: fallbackName.trim() || 'My Workspace',
      owner_id: userId,
    })
    .select('id')
    .single();

  if (workspaceError || !workspace?.id) {
    throw new Error(workspaceError?.message || 'Failed to create workspace.');
  }

  const { error: memberError } = await admin
    .from('workspace_members')
    .insert({
      workspace_id: workspace.id,
      user_id: userId,
      role: 'owner',
    });

  if (memberError) {
    throw new Error(memberError.message || 'Failed to create workspace membership.');
  }

  return workspace.id;
}

async function createSelfServeCampaignIfNeeded(params: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
  userId: string;
  countryCode: string | null;
  draft: ReturnType<typeof normalizeSelfServeCampaignDraft>;
}): Promise<string | null> {
  if (!params.draft) return null;

  const { data: existingCampaign } = await params.admin
    .from('campaigns')
    .select('id')
    .eq('workspace_id', params.workspaceId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existingCampaign?.id) return existingCampaign.id;

  const campaignName = params.draft.name?.trim()
    ? `${params.draft.name.trim()} Campaign`
    : SELF_SERVE_CAMPAIGN_NAME;

  const { data: campaign, error } = await params.admin
    .from('campaigns')
    .insert({
      owner_id: params.userId,
      workspace_id: params.workspaceId,
      name: campaignName,
      title: campaignName,
      description: 'Self-serve prospecting map created from the demo flow.',
      type: 'prospecting',
      address_source: 'map',
      region: params.countryCode,
      seed_query: null,
      tags: 'self-serve-demo,prospecting-map',
      bbox: params.draft.bbox,
      territory_boundary: params.draft.polygon,
      total_flyers: 0,
      scans: 0,
      conversions: 0,
      status: 'draft',
      provision_status: 'pending',
      provision_phase: 'created',
      provision_source: null,
      provisioned_at: null,
      addresses_ready_at: null,
      map_ready_at: null,
      optimized_at: null,
      has_parcels: false,
      building_link_confidence: 0,
      map_mode: 'standard_pins',
      parcel_enrichment_status: 'not_started',
      link_quality_status: 'unknown',
      link_quality_score: 0,
      link_quality_reason: null,
      link_quality_checked_at: null,
      link_quality_metrics: {},
    })
    .select('id')
    .single();

  if (error || !campaign?.id) {
    throw new Error(error?.message || 'Failed to create campaign.');
  }

  return campaign.id;
}

async function getAccessTokenForProvision(email: string, password: string): Promise<string | null> {
  const authClient = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  const {
    data: { session },
    error,
  } = await authClient.auth.signInWithPassword({ email, password });

  if (error || !session?.access_token) return null;
  return session.access_token;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const email = normalizeEmail(body?.email);
    const password = typeof body?.password === 'string' ? body.password : '';
    const firstName = typeof body?.firstName === 'string' ? body.firstName.trim() : '';
    const lastName = typeof body?.lastName === 'string' ? body.lastName.trim() : '';
    const countryCode = normalizeCountryCode(
      typeof body?.countryCode === 'string' ? body.countryCode : undefined
    );
    const selfServeCampaignDraft = normalizeSelfServeCampaignDraft(body?.selfServeCampaignDraft);

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Enter a valid email.' }, { status: 400 });
    }

    if (password.trim().length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 });
    }

    const admin = createAdminClient();
    let userId: string | null = null;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        first_name: firstName || undefined,
        last_name: lastName || undefined,
        country_code: countryCode || undefined,
        onboarding_source: 'self-serve-demo',
      },
    });

    if (error) {
      if (isTransientAuthServiceError(error)) {
        console.warn('[onboarding/self-serve-account] auth service unavailable:', error.message);
        return authServiceUnavailableResponse();
      }
      if (isDuplicateUserError(error)) {
        const unconfirmedUser = await findUnconfirmedUserByEmail(admin, email);
        if (unconfirmedUser?.id) {
          const { error: updateError } = await admin.auth.admin.updateUserById(
            unconfirmedUser.id,
            {
              password,
              email_confirm: true,
              user_metadata: {
                ...(unconfirmedUser.user_metadata ?? {}),
                first_name: firstName || undefined,
                last_name: lastName || undefined,
                country_code: countryCode || undefined,
                onboarding_source: 'self-serve-demo',
              },
            }
          );
          if (!updateError) {
            userId = unconfirmedUser.id;
          } else {
            console.warn('[onboarding/self-serve-account] unconfirmed user recovery failed:', updateError);
          }
        }
        if (!userId) {
          return NextResponse.json({ ok: true, existing: true });
        }
      } else {
        return NextResponse.json(
          { error: error.message || 'Could not create account.' },
          { status: 400 }
        );
      }
    }

    userId = userId ?? data.user?.id ?? null;
    let earlyCampaignId: string | null = null;
    if (userId) {
      const profileUpdates = {
        user_id: userId,
        first_name: firstName || null,
        last_name: lastName || null,
        country_code: countryCode,
      };
      const { error: profileError } = await admin
        .from('user_profiles')
        .upsert(profileUpdates, { onConflict: 'user_id' });

      if (profileError) {
        console.warn('[onboarding/self-serve-account] profile upsert failed:', profileError);
      }

      try {
        const workspaceId = await ensureWorkspaceForUser(
          admin,
          userId,
          firstName || 'My Workspace'
        );
        earlyCampaignId = await createSelfServeCampaignIfNeeded({
          admin,
          workspaceId,
          userId,
          countryCode,
          draft: selfServeCampaignDraft,
        });
      } catch (campaignError) {
        console.warn('[onboarding/self-serve-account] early campaign bootstrap failed:', campaignError);
      }
    }

    if (earlyCampaignId) {
      const origin = request.nextUrl.origin;
      after(async () => {
        try {
          const accessToken = await getAccessTokenForProvision(email, password);
          if (!accessToken) return;
          const response = await fetch(`${origin}/api/campaigns/provision`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ campaign_id: earlyCampaignId }),
          });
          if (!response.ok) {
            const payload = await response.json().catch(() => ({}));
            console.warn(
              '[onboarding/self-serve-account] early provision failed:',
              payload?.error ?? response.statusText
            );
          }
        } catch (provisionError) {
          console.warn('[onboarding/self-serve-account] early provision failed:', provisionError);
        }
      });
    }

    return NextResponse.json({ ok: true, existing: false, campaignId: earlyCampaignId });
  } catch (error) {
    if (isTransientAuthServiceError(error)) {
      console.warn(
        '[onboarding/self-serve-account] auth service unavailable:',
        error instanceof Error ? error.message : String(error)
      );
      return authServiceUnavailableResponse();
    }
    console.error('[onboarding/self-serve-account] failed:', error);
    return NextResponse.json({ error: 'Could not create account.' }, { status: 500 });
  }
}
