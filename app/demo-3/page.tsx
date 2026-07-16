import type { Metadata } from 'next';
import { DialerVideoLanding } from '../power-dialer/DialerVideoLanding';
import { normalizeSalespersonReferralCodeInput } from '@/app/lib/billing/salespeople';

const FOUNDER_CALL_HREF =
  process.env.NEXT_PUBLIC_FOUNDER_CALL_URL ||
  'https://calendly.com/daniel-phillippe';
const DEMO_THREE_STREAM_CUSTOMER_CODE = process.env.NEXT_PUBLIC_CLOUDFLARE_STREAM_CUSTOMER_CODE;
const DEMO_THREE_STREAM_VIDEO_UID =
  process.env.NEXT_PUBLIC_DEMO_THREE_STREAM_VIDEO_UID ||
  'efb7769ec5cdce81732b3d3f669bc30e';
const configuredDemoThreeCtaAtSeconds = Number(process.env.NEXT_PUBLIC_DEMO_THREE_VIDEO_CTA_AT_SECONDS);
const DEMO_THREE_CTA_AT_SECONDS =
  Number.isFinite(configuredDemoThreeCtaAtSeconds) && configuredDemoThreeCtaAtSeconds > 0
    ? configuredDemoThreeCtaAtSeconds
    : 135;

export const metadata: Metadata = {
  title: 'WolfGrid: Campaign creation demo',
  description: 'Watch the WolfGrid campaign creation demo and start with one campaign included. No credit card.',
  openGraph: {
    title: 'WolfGrid: Campaign creation demo',
    description: 'Watch the campaign creation demo and start with one campaign included. No credit card.',
    url: 'https://wolfgrid.app/demo-3',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'WolfGrid: Campaign creation demo',
    description: 'Watch the campaign creation demo and start with one campaign included. No credit card.',
    images: ['/twitter-image'],
  },
};

type DemoThreePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

async function buildOnboardingHref(searchParams?: DemoThreePageProps['searchParams']) {
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

async function buildTrackingProps(searchParams?: DemoThreePageProps['searchParams']) {
  const params = await searchParams;
  return {
    referralCode: normalizeSalespersonReferralCodeInput(
      firstParam(params?.referralCode ?? params?.ref)
    ),
    source: firstParam(params?.source),
    campaign: firstParam(params?.campaign) || 'campaign-creation-demo',
    demoLinkToken: firstParam(params?.demoLink),
  };
}

export default async function DemoThreePage({ searchParams }: DemoThreePageProps) {
  const tracking = await buildTrackingProps(searchParams);

  return (
    <DialerVideoLanding
      customerCode={DEMO_THREE_STREAM_CUSTOMER_CODE}
      videoUid={DEMO_THREE_STREAM_VIDEO_UID}
      posterUrl={process.env.NEXT_PUBLIC_DEMO_THREE_STREAM_POSTER_URL}
      videoTitle="WolfGrid campaign creation demo"
      redirectAtSeconds={DEMO_THREE_CTA_AT_SECONDS}
      onboardingHref={await buildOnboardingHref(searchParams)}
      primaryCtaLabel="Build FREE WolfGrid Map"
      founderCallHref={FOUNDER_CALL_HREF}
      endCtaEyebrow="Try WolfGrid for free today"
      endCtaTitle="Build your first 3D prospecting map"
      showFounderCallButton={false}
      referralCode={tracking.referralCode}
      trackingSource={tracking.source}
      trackingCampaign={tracking.campaign}
      demoLinkToken={tracking.demoLinkToken}
    />
  );
}
