import type { Metadata } from 'next';
import { siteVideo } from '@/lib/demo/siteVideos';
import { DialerVideoLanding } from '../power-dialer/DialerVideoLanding';
import { normalizeSalespersonReferralCodeInput } from '@/app/lib/billing/salespeople';

const FOUNDER_CALL_HREF =
  process.env.NEXT_PUBLIC_FOUNDER_CALL_URL ||
  'https://calendly.com/daniel-phillippe';
const VIDEO = siteVideo(
  'power-dialer',
  process.env.NEXT_PUBLIC_DIALER_VIDEO_URL,
  process.env.NEXT_PUBLIC_DIALER_VIDEO_POSTER_URL,
);
const configuredCtaAtSeconds = Number(process.env.NEXT_PUBLIC_DIALER_VIDEO_CTA_AT_SECONDS);
const DIALER_VIDEO_CTA_AT_SECONDS =
  Number.isFinite(configuredCtaAtSeconds) && configuredCtaAtSeconds > 0
    ? configuredCtaAtSeconds
    : 85;

export const metadata: Metadata = {
  title: 'WolfGrid: Real estate team demo',
  description: 'Watch the WolfGrid demo and start with one campaign included. No credit card.',
  openGraph: {
    title: 'WolfGrid: Real estate team demo',
    description: 'Watch the demo and start with one campaign included. No credit card.',
    url: 'https://wolfgrid.app/demo-1',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'WolfGrid: Real estate team demo',
    description: 'Watch the demo and start with one campaign included. No credit card.',
    images: ['/twitter-image'],
  },
};

type DemoOnePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

async function buildOnboardingHref(searchParams?: DemoOnePageProps['searchParams']) {
  const params = await searchParams;
  const referralCode = normalizeSalespersonReferralCodeInput(
    firstParam(params?.referralCode ?? params?.ref)
  );
  const createMapParams = new URLSearchParams({
    source: 'self-serve-demo',
    campaign: 'self-serve-campaign',
  });

  if (referralCode) {
    createMapParams.set('referralCode', referralCode);
  }

  return `/campaigns/create?${createMapParams.toString()}`;
}

async function buildTrackingProps(searchParams?: DemoOnePageProps['searchParams']) {
  const params = await searchParams;
  return {
    referralCode: normalizeSalespersonReferralCodeInput(
      firstParam(params?.referralCode ?? params?.ref)
    ),
    source: firstParam(params?.source),
    campaign: firstParam(params?.campaign),
    demoLinkToken: firstParam(params?.demoLink),
  };
}

export default async function DemoOnePage({ searchParams }: DemoOnePageProps) {
  const tracking = await buildTrackingProps(searchParams);

  return (
    <DialerVideoLanding
      videoUrl={VIDEO.src}
      posterUrl={VIDEO.poster}
      onboardingHref={await buildOnboardingHref(searchParams)}
      primaryCtaLabel="Create FREE WolfGrid Map"
      founderCallHref={FOUNDER_CALL_HREF}
      endCtaEyebrow="Try WolfGrid for free today"
      endCtaTitle="Create your first 3D prospecting map"
      showFounderCallButton={false}
      redirectAtSeconds={DIALER_VIDEO_CTA_AT_SECONDS}
      referralCode={tracking.referralCode}
      trackingSource={tracking.source}
      trackingCampaign={tracking.campaign}
      demoLinkToken={tracking.demoLinkToken}
    />
  );
}
