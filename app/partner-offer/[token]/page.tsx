import type { Metadata } from 'next';
import { createAdminClient } from '@/lib/supabase/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PartnerOfferLanding } from '@/components/landing/PartnerOfferLanding';

type Params = {
  params: Promise<{ token: string }>;
};

type PartnerOfferRow = {
  id: string;
  token: string;
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

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
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

function isOfferAvailable(offer: PartnerOfferRow): boolean {
  if (offer.revoked_at) return false;
  if (new Date(offer.expires_at).getTime() <= Date.now()) return false;
  if (offer.max_views != null && offer.view_count >= offer.max_views) return false;
  return true;
}

export default async function PartnerOfferPage({ params }: Params) {
  const { token } = await params;
  const admin = createAdminClient();

  const { data, error } = await admin
    .from('partner_offers')
    .select(
      'id, token, recipient_name, partner_name, offer_title, offer_message, cta_label, cta_url, max_views, view_count, expires_at, revoked_at'
    )
    .eq('token', token)
    .maybeSingle();

  const offer = (error ? null : (data as PartnerOfferRow | null)) ?? null;
  const isAvailable = offer ? isOfferAvailable(offer) : false;

  if (offer && isAvailable) {
    await admin
      .from('partner_offers')
      .update({
        view_count: offer.view_count + 1,
        last_viewed_at: new Date().toISOString(),
      })
      .eq('id', offer.id);
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
    />
  );
}
