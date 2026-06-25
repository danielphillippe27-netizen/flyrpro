import type { Metadata } from 'next';
import { DialerVideoLanding } from '../power-dialer/DialerVideoLanding';
import { normalizeSalespersonReferralCodeInput } from '@/app/lib/billing/salespeople';

const FOUNDER_CALL_HREF =
  process.env.NEXT_PUBLIC_FOUNDER_CALL_URL ||
  'https://calendly.com/daniel-phillippe';
const DIALER_STREAM_CUSTOMER_CODE = process.env.NEXT_PUBLIC_CLOUDFLARE_STREAM_CUSTOMER_CODE;
const DIALER_STREAM_VIDEO_UID = process.env.NEXT_PUBLIC_DIALER_STREAM_VIDEO_UID;
const configuredDialerVideoUrl = process.env.NEXT_PUBLIC_DIALER_VIDEO_URL;
const DIALER_VIDEO_URL =
  DIALER_STREAM_CUSTOMER_CODE && DIALER_STREAM_VIDEO_UID
    ? undefined
    : configuredDialerVideoUrl;
const configuredCtaAtSeconds = Number(process.env.NEXT_PUBLIC_DIALER_VIDEO_CTA_AT_SECONDS);
const DIALER_VIDEO_CTA_AT_SECONDS =
  Number.isFinite(configuredCtaAtSeconds) && configuredCtaAtSeconds > 0
    ? configuredCtaAtSeconds
    : 85;

export const metadata: Metadata = {
  title: 'FLYR: Real estate team demo',
  description: 'Watch the FLYR demo and start a 14 day free trial. No credit card.',
  openGraph: {
    title: 'FLYR: Real estate team demo',
    description: 'Watch the demo and start a 14 day free trial. No credit card.',
    url: 'https://www.flyrpro.app/demo-1',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'FLYR: Real estate team demo',
    description: 'Watch the demo and start a 14 day free trial. No credit card.',
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
  const onboardingParams = new URLSearchParams({
    source: 'dialer',
    campaign: 'power-dialer',
  });

  if (referralCode) {
    onboardingParams.set('referralCode', referralCode);
  }

  return `/onboarding?${onboardingParams.toString()}`;
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
      videoUrl={DIALER_VIDEO_URL}
      customerCode={DIALER_STREAM_CUSTOMER_CODE}
      videoUid={DIALER_STREAM_VIDEO_UID}
      posterUrl={process.env.NEXT_PUBLIC_DIALER_STREAM_POSTER_URL}
      onboardingHref={await buildOnboardingHref(searchParams)}
      founderCallHref={FOUNDER_CALL_HREF}
      redirectAtSeconds={DIALER_VIDEO_CTA_AT_SECONDS}
      referralCode={tracking.referralCode}
      trackingSource={tracking.source}
      trackingCampaign={tracking.campaign}
      demoLinkToken={tracking.demoLinkToken}
    />
  );
}
