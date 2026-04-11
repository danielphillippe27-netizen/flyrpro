import type { SupabaseClient } from '@supabase/supabase-js';

const FALLBACK_SLUG = 'offer';

export function slugifyPartnerOfferPath(value: string): string {
  const base = value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  return base || FALLBACK_SLUG;
}

export async function resolveUniquePartnerOfferSlug(
  admin: SupabaseClient,
  preferredSlug: string,
  excludeOfferId?: string
): Promise<string> {
  const baseSlug = slugifyPartnerOfferPath(preferredSlug);

  for (let index = 0; index < 100; index += 1) {
    const candidate = index === 0 ? baseSlug : `${baseSlug}-${index + 1}`;
    let query = admin.from('partner_offers').select('id').eq('vanity_slug', candidate).limit(1);

    if (excludeOfferId) {
      query = query.neq('id', excludeOfferId);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(error.message);
    }

    if (!data || data.length === 0) {
      return candidate;
    }
  }

  throw new Error('Unable to generate a unique partner offer link');
}
