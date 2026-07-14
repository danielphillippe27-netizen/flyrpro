import type { Metadata } from 'next';
import { BeaconPageClient } from '@/components/beacon/BeaconPageClient';
import { getPublicBeaconByToken } from '@/lib/beacon/public';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Params = {
  params: Promise<{ token: string }>;
};

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { token } = await params;
  const payload = await getPublicBeaconByToken(token);
  const viewerName = payload.share?.viewer_label?.trim();

  return {
    title: viewerName ? `${viewerName} Beacon` : 'WolfGrid Beacon',
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default async function BeaconPage({ params }: Params) {
  const { token } = await params;
  const payload = await getPublicBeaconByToken(token);

  return <BeaconPageClient token={token} initialPayload={payload} />;
}
