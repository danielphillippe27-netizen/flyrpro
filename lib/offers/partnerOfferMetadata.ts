import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { isJustListedDmOffer } from '@/components/offers/partnerOfferUtils';
import type { PublicPartnerOfferRow } from '@/lib/offers/publicPartnerOffer';

function fallbackOrigin() {
  return 'https://wolfgrid.app';
}

async function getRequestOrigin() {
  const headerStore = await headers();
  const host = headerStore.get('x-forwarded-host') ?? headerStore.get('host');

  if (!host) {
    return fallbackOrigin();
  }

  const protocol = headerStore.get('x-forwarded-proto') ?? 'https';
  return `${protocol}://${host}`;
}

export async function buildPartnerOfferMetadata(
  offer: Pick<PublicPartnerOfferRow, 'offer_title' | 'offer_message'>
): Promise<Metadata> {
  const justListed = isJustListedDmOffer(offer.offer_title, offer.offer_message);

  if (!justListed) {
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

  const origin = await getRequestOrigin();
  const imageUrl = `${origin}/api/partner-offer-card?template=just-listed-dm`;

  return {
    title: 'Leverage your listing',
    description: 'Door-to-door software',
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
    openGraph: {
      title: 'Leverage your listing',
      description: 'Door-to-door software',
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: 'WolfGrid just listed preview card',
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'Leverage your listing',
      description: 'Door-to-door software',
      images: [imageUrl],
    },
  };
}
