import type { SupabaseClient } from '@supabase/supabase-js';

export type PublicPartnerOfferRow = {
  id: string;
  token: string;
  vanity_slug: string | null;
  recipient_name: string | null;
  partner_name: string;
  offer_title: string;
  offer_message: string | null;
  cta_label: string | null;
  cta_url: string | null;
  max_views: number | null;
  view_count: number;
  expires_at: string;
  revoked_at: string | null;
};

const PUBLIC_PARTNER_OFFER_SELECT =
  'id, token, vanity_slug, recipient_name, partner_name, offer_title, offer_message, cta_label, cta_url, max_views, view_count, expires_at, revoked_at';

export function isPublicPartnerOfferAvailable(offer: PublicPartnerOfferRow): boolean {
  if (offer.revoked_at) return false;
  if (new Date(offer.expires_at).getTime() <= Date.now()) return false;
  if (offer.max_views != null && offer.view_count >= offer.max_views) return false;
  return true;
}

async function loadPublicPartnerOffer(
  admin: SupabaseClient,
  column: 'token' | 'vanity_slug',
  value: string
): Promise<PublicPartnerOfferRow | null> {
  const { data, error } = await admin
    .from('partner_offers')
    .select(PUBLIC_PARTNER_OFFER_SELECT)
    .eq(column, value)
    .maybeSingle();

  if (error) {
    return null;
  }

  return (data as PublicPartnerOfferRow | null) ?? null;
}

export async function loadPublicPartnerOfferByToken(admin: SupabaseClient, token: string) {
  return loadPublicPartnerOffer(admin, 'token', token);
}

export async function loadPublicPartnerOfferByVanitySlug(admin: SupabaseClient, slug: string) {
  return loadPublicPartnerOffer(admin, 'vanity_slug', slug);
}

export async function incrementPublicPartnerOfferView(
  admin: SupabaseClient,
  offer: Pick<PublicPartnerOfferRow, 'id' | 'view_count'>
) {
  await admin
    .from('partner_offers')
    .update({
      view_count: offer.view_count + 1,
      last_viewed_at: new Date().toISOString(),
    })
    .eq('id', offer.id);
}
