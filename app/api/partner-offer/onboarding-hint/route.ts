import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { loadPublicPartnerOfferByToken } from '@/lib/offers/publicPartnerOffer';
import {
  isPartnerOfferTeamExclusiveOnboarding,
  isThirtyDayChallengePartnerOffer,
} from '@/components/offers/partnerOfferUtils';

/**
 * Resolves team vs solo partner onboarding for legacy URLs without `partnerExclusive=`.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')?.trim();
  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  }

  const admin = createAdminClient();
  const offer = await loadPublicPartnerOfferByToken(admin, token);
  if (!offer) {
    return NextResponse.json({ partnerExclusive: 'team', challenge30: false });
  }

  const partnerExclusive = isPartnerOfferTeamExclusiveOnboarding(offer.offer_title, offer.offer_message)
    ? 'team'
    : 'solo';

  const challenge30 = isThirtyDayChallengePartnerOffer(offer.offer_title, offer.offer_message);

  return NextResponse.json({ partnerExclusive, challenge30 });
}
