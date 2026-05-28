import { randomUUID } from 'crypto';
import { isMissingAmbassadorSchemaError, type SupabaseAdmin } from '@/app/lib/billing/ambassador-program';
import { type ApprovedAmbassador } from '@/app/lib/billing/ambassador-access';
import {
  AMBASSADOR_LANDING_DEFAULTS,
  isReservedPartnerSlug,
  normalizePartnerSlug,
} from '@/app/lib/ambassador/portal';

export type AmbassadorLandingPageRow = {
  id: string;
  ambassador_application_id: string;
  slug: string;
  display_name: string | null;
  headline: string | null;
  intro_message: string | null;
  profile_image_url: string | null;
  hero_video_url: string | null;
  audience_type: string | null;
  cta_text: string | null;
  offer_text: string | null;
  is_published: boolean;
  created_at: string;
  updated_at: string;
};

function defaultSlugSeed(ambassador: ApprovedAmbassador): string {
  return ambassador.full_name || ambassador.referral_code || `partner-${ambassador.id.slice(0, 8)}`;
}

export async function resolveUniqueAmbassadorSlug(
  admin: SupabaseAdmin,
  desiredSlug: string,
  currentLandingPageId?: string | null
): Promise<string> {
  const base = normalizePartnerSlug(desiredSlug);
  if (!base || isReservedPartnerSlug(base)) {
    throw new Error('Choose a different username.');
  }

  for (let index = 0; index < 20; index += 1) {
    const candidate =
      index === 0 ? base : `${base.slice(0, 54)}-${randomUUID().slice(0, 6)}`;
    const [landingResult, offerResult] = await Promise.all([
      admin
        .from('ambassador_landing_pages')
        .select('id')
        .eq('slug', candidate)
        .limit(1),
      admin
        .from('partner_offers')
        .select('id')
        .eq('vanity_slug', candidate)
        .limit(1),
    ]);

    if (landingResult.error) throw new Error(landingResult.error.message);
    if (
      offerResult.error &&
      !isMissingAmbassadorSchemaError(offerResult.error.message)
    ) {
      throw new Error(offerResult.error.message);
    }

    const matchingId = landingResult.data?.[0]?.id;
    const offerMatches = !offerResult.error && (offerResult.data?.length ?? 0) > 0;
    if ((!matchingId || matchingId === currentLandingPageId) && !offerMatches) {
      return candidate;
    }
  }

  throw new Error('Could not generate a unique landing page slug.');
}

export async function getOrCreateAmbassadorLandingPage(
  admin: SupabaseAdmin,
  ambassador: ApprovedAmbassador
): Promise<AmbassadorLandingPageRow> {
  const { data: existing, error: existingError } = await admin
    .from('ambassador_landing_pages')
    .select(
      'id, ambassador_application_id, slug, display_name, headline, intro_message, profile_image_url, hero_video_url, audience_type, cta_text, offer_text, is_published, created_at, updated_at'
    )
    .eq('ambassador_application_id', ambassador.id)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);
  if (existing) return existing as AmbassadorLandingPageRow;

  const slug = await resolveUniqueAmbassadorSlug(admin, defaultSlugSeed(ambassador));
  const { data: inserted, error: insertError } = await admin
    .from('ambassador_landing_pages')
    .insert({
      ambassador_application_id: ambassador.id,
      slug,
      display_name: ambassador.full_name,
      headline: AMBASSADOR_LANDING_DEFAULTS.headline,
      intro_message: AMBASSADOR_LANDING_DEFAULTS.introMessage,
      cta_text: AMBASSADOR_LANDING_DEFAULTS.ctaText,
      offer_text: AMBASSADOR_LANDING_DEFAULTS.offerText,
    })
    .select(
      'id, ambassador_application_id, slug, display_name, headline, intro_message, profile_image_url, hero_video_url, audience_type, cta_text, offer_text, is_published, created_at, updated_at'
    )
    .single();

  if (insertError) throw new Error(insertError.message);
  return inserted as AmbassadorLandingPageRow;
}
