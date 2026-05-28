import type { SupabaseAdmin } from '@/app/lib/billing/ambassador-program';

export type PublicAmbassadorLandingPage = {
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
  ambassador: {
    id: string;
    full_name: string;
    referral_code: string;
    status: 'approved';
  };
};

export async function loadPublicAmbassadorLandingBySlug(
  admin: SupabaseAdmin,
  slug: string
): Promise<PublicAmbassadorLandingPage | null> {
  const { data: page, error: pageError } = await admin
    .from('ambassador_landing_pages')
    .select(
      'id, ambassador_application_id, slug, display_name, headline, intro_message, profile_image_url, hero_video_url, audience_type, cta_text, offer_text, is_published'
    )
    .eq('slug', slug)
    .eq('is_published', true)
    .maybeSingle();

  if (pageError || !page) return null;

  const landingPage = page as Omit<PublicAmbassadorLandingPage, 'ambassador'>;
  const { data: ambassador } = await admin
    .from('ambassador_applications')
    .select('id, full_name, referral_code, status')
    .eq('id', landingPage.ambassador_application_id)
    .eq('status', 'approved')
    .maybeSingle();

  const referralCode =
    typeof ambassador?.referral_code === 'string'
      ? ambassador.referral_code.trim().toUpperCase()
      : '';

  if (!ambassador || !referralCode) return null;

  return {
    ...landingPage,
    ambassador: {
      id: ambassador.id,
      full_name: ambassador.full_name,
      referral_code: referralCode,
      status: 'approved',
    },
  };
}
