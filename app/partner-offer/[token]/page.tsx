import type { Metadata } from 'next';
import { createAdminClient } from '@/lib/supabase/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PartnerOfferLanding } from '@/components/landing/PartnerOfferLanding';
import {
  incrementPublicPartnerOfferView,
  isPublicPartnerOfferAvailable,
  loadPublicPartnerOfferByToken,
} from '@/lib/offers/publicPartnerOffer';
import { buildPartnerOfferMetadata } from '@/lib/offers/partnerOfferMetadata';
import { isPartnerOfferTeamExclusiveOnboarding } from '@/components/offers/partnerOfferUtils';

type Params = {
  params: Promise<{ token: string }>;
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { token } = await params;
  const admin = createAdminClient();
  const offer = await loadPublicPartnerOfferByToken(admin, token);

  if (!offer) {
    return {
      title: 'Private Partner Offer',
      robots: {
        index: false,
        follow: false,
        nocache: true,
        googleBot: {
          index: false,
          follow: false,
          noimageindex: true,
        },
      },
    };
  }

  return buildPartnerOfferMetadata(offer);
}

export default async function PartnerOfferPage({ params }: Params) {
  const { token } = await params;
  const admin = createAdminClient();

  const offer = await loadPublicPartnerOfferByToken(admin, token);
  const isAvailable = offer ? isPublicPartnerOfferAvailable(offer) : false;

  if (offer && isAvailable) {
    await incrementPublicPartnerOfferView(admin, offer);
  }

  if (!offer || !isAvailable) {
    return (
      <main className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center p-6">
        <Card className="w-full max-w-xl border-slate-200">
          <CardHeader>
            <CardTitle>Private Offer Unavailable</CardTitle>
            <CardDescription>
              This invite-only page is expired, revoked, or not valid.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-slate-600">
            If you expected access, contact your FLYR point of contact for a fresh private link.
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <PartnerOfferLanding
      offerTitle={offer.offer_title}
      offerMessage={offer.offer_message}
      partnerName={offer.partner_name}
      recipientName={offer.recipient_name}
      expiresAt={offer.expires_at}
      ctaLabel={offer.cta_label}
      offerToken={offer.token}
      partnerOnboardingTeamStyle={isPartnerOfferTeamExclusiveOnboarding(
        offer.offer_title,
        offer.offer_message
      )}
    />
  );
}
