import type { Metadata } from 'next';
import { DialerVideoLanding } from '../power-dialer/DialerVideoLanding';
import { normalizeSalespersonReferralCodeInput } from '@/app/lib/billing/salespeople';

const FOUNDER_CALL_HREF =
  process.env.NEXT_PUBLIC_FOUNDER_CALL_URL ||
  'https://calendly.com/daniel-phillippe';
const DEMO_TWO_STREAM_VIDEO_UID =
  process.env.NEXT_PUBLIC_DEMO_TWO_STREAM_VIDEO_UID ||
  '244ac3821805b94bfa36585ba804d24e';
const DEMO_TWO_CTA_AT_SECONDS = 77;

export const metadata: Metadata = {
  title: 'FLYR: Realtor Demo',
  description: 'Watch the FLYR individual agent listing demo and start with one campaign included. No credit card.',
  openGraph: {
    title: 'FLYR: Realtor Demo',
    description: 'Watch the individual agent listing demo and start with one campaign included. No credit card.',
    url: 'https://www.flyrpro.app/demo-2',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FLYR: Realtor Demo',
    description: 'Watch the individual agent listing demo and start with one campaign included. No credit card.',
    images: ['/twitter-image'],
  },
};

type DemoTwoPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

async function buildOnboardingHref(searchParams?: DemoTwoPageProps['searchParams']) {
  const params = await searchParams;
  const referralCode = normalizeSalespersonReferralCodeInput(
    firstParam(params?.referralCode ?? params?.ref)
  );
  const onboardingParams = new URLSearchParams({
    source: 'dialer',
    campaign: 'individual-agent-listing',
  });

  if (referralCode) {
    onboardingParams.set('referralCode', referralCode);
  }

  return `/onboarding?${onboardingParams.toString()}`;
}

async function buildTrackingProps(searchParams?: DemoTwoPageProps['searchParams']) {
  const params = await searchParams;
  return {
    referralCode: normalizeSalespersonReferralCodeInput(
      firstParam(params?.referralCode ?? params?.ref)
    ),
    source: firstParam(params?.source),
    campaign: firstParam(params?.campaign) || 'individual-agent-listing',
    demoLinkToken: firstParam(params?.demoLink),
  };
}

export default async function DemoTwoPage({ searchParams }: DemoTwoPageProps) {
  const tracking = await buildTrackingProps(searchParams);

  return (
    <DialerVideoLanding
      videoUid={DEMO_TWO_STREAM_VIDEO_UID}
      posterUrl={process.env.NEXT_PUBLIC_DEMO_TWO_STREAM_POSTER_URL}
      videoOrientation="portrait"
      videoTitle="FLYR individual agent listing demo"
      redirectAtSeconds={DEMO_TWO_CTA_AT_SECONDS}
      mutedAutoplay={false}
      onboardingHref={await buildOnboardingHref(searchParams)}
      founderCallHref={FOUNDER_CALL_HREF}
      referralCode={tracking.referralCode}
      trackingSource={tracking.source}
      trackingCampaign={tracking.campaign}
      demoLinkToken={tracking.demoLinkToken}
    />
  );
}
