import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PartnerOfferLanding } from '@/components/landing/PartnerOfferLanding';
import { PublicAmbassadorLanding } from '@/components/ambassador/PublicAmbassadorLanding';
import {
  incrementPublicPartnerOfferView,
  isPublicPartnerOfferAvailable,
  loadPublicPartnerOfferByVanitySlug,
} from '@/lib/offers/publicPartnerOffer';
import { buildPartnerOfferMetadata } from '@/lib/offers/partnerOfferMetadata';
import { isPartnerOfferTeamExclusiveOnboarding } from '@/components/offers/partnerOfferUtils';
import { loadPublicAmbassadorLandingBySlug } from '@/app/lib/ambassador/public-landing';
import { isMissingAmbassadorSchemaError } from '@/app/lib/billing/ambassador-program';
import { sanitizeTrackingParam } from '@/app/lib/ambassador/portal';

type Params = {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{
    source?: string;
    campaign?: string;
  }>;
};

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const admin = createAdminClient();
  const offer = await loadPublicPartnerOfferByVanitySlug(admin, slug);

  if (!offer) {
    const ambassadorLanding = await loadPublicAmbassadorLandingBySlug(admin, slug);
    if (ambassadorLanding) {
      return {
        title: ambassadorLanding.headline || 'WolfGrid Partner Offer',
        description:
          ambassadorLanding.intro_message ||
          'Start with one included campaign through a WolfGrid ambassador link.',
      };
    }

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

export default async function PartnerOfferVanityPage({ params, searchParams }: Params) {
  const { slug } = await params;
  const query = await searchParams;
  const admin = createAdminClient();

  const offer = await loadPublicPartnerOfferByVanitySlug(admin, slug);
  if (!offer) {
    const landingPage = await loadPublicAmbassadorLandingBySlug(admin, slug);
    if (!landingPage) {
      notFound();
    }

    const landingPageEvent = {
      ambassador_application_id: landingPage.ambassador.id,
      landing_page_id: landingPage.id,
      slug: landingPage.slug,
      event_type: 'view',
      source: sanitizeTrackingParam(query?.source),
      campaign: sanitizeTrackingParam(query?.campaign),
    };

    await admin
      .from('ambassador_landing_page_events')
      .insert(landingPageEvent)
      .then(({ error }) => {
        if (error && !isMissingAmbassadorSchemaError(error.message)) {
          console.warn('[ambassador vanity page] view tracking failed', error);
        }
        if (!error || !isMissingAmbassadorSchemaError(error.message)) return null;
        return admin.from('ambassador_landing_page_events').insert({
          ambassador_application_id: landingPageEvent.ambassador_application_id,
          landing_page_id: landingPageEvent.landing_page_id,
          slug: landingPageEvent.slug,
          event_type: landingPageEvent.event_type,
        });
      });

    return (
      <PublicAmbassadorLanding
        landingPage={landingPage}
        source={query?.source}
        campaign={query?.campaign}
      />
    );
  }

  const isAvailable = isPublicPartnerOfferAvailable(offer);

  if (isAvailable) {
    await incrementPublicPartnerOfferView(admin, offer);
  }

  if (!isAvailable) {
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
            If you expected access, contact your WolfGrid point of contact for a fresh private link.
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
