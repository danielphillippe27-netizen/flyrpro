import type { Metadata } from 'next';
import { DialerVideoLanding } from '../power-dialer/DialerVideoLanding';
import { normalizeSalespersonReferralCodeInput } from '@/app/lib/billing/salespeople';
import {
  DEMO_44_REFERRAL_CAMPAIGN,
  DEMO_44_TEAM_TRIAL_OFFER,
} from '@/lib/demo/demo44TeamTrial';

const FOUNDER_CALL_HREF =
  process.env.NEXT_PUBLIC_FOUNDER_CALL_URL ||
  'https://calendly.com/daniel-phillippe';
const DEMO_FORTY_FOUR_STREAM_CUSTOMER_CODE =
  process.env.NEXT_PUBLIC_CLOUDFLARE_STREAM_CUSTOMER_CODE;
const DEMO_FORTY_FOUR_STREAM_VIDEO_UID =
  process.env.NEXT_PUBLIC_DEMO_FORTY_FOUR_STREAM_VIDEO_UID ||
  process.env.NEXT_PUBLIC_DEMO_THREE_STREAM_VIDEO_UID ||
  'efb7769ec5cdce81732b3d3f669bc30e';
const configuredDemoFortyFourCtaAtSeconds = Number(
  process.env.NEXT_PUBLIC_DEMO_FORTY_FOUR_VIDEO_CTA_AT_SECONDS ??
    process.env.NEXT_PUBLIC_DEMO_THREE_VIDEO_CTA_AT_SECONDS
);
const DEMO_FORTY_FOUR_CTA_AT_SECONDS =
  Number.isFinite(configuredDemoFortyFourCtaAtSeconds) &&
  configuredDemoFortyFourCtaAtSeconds > 0
    ? configuredDemoFortyFourCtaAtSeconds
    : 135;

export const metadata: Metadata = {
  title: 'WolfGrid: 90-day team trial',
  description:
    'See WolfGrid for team leads, then give your whole team 90 days to try it free and share feedback. No credit card.',
  openGraph: {
    title: 'WolfGrid: 90-day team trial',
    description:
      'Give your whole team 90 days to try WolfGrid free and share feedback. No credit card.',
    url: 'https://wolfgrid.app/demo-44',
    images: ['/opengraph-image'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'WolfGrid: 90-day team trial',
    description:
      'Give your whole team 90 days to try WolfGrid free and share feedback. No credit card.',
    images: ['/twitter-image'],
  },
};

type DemoFortyFourPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

async function buildOnboardingHref(
  searchParams?: DemoFortyFourPageProps['searchParams']
) {
  const params = await searchParams;
  const referralCode = normalizeSalespersonReferralCodeInput(
    firstParam(params?.referralCode ?? params?.ref)
  );
  const createMapParams = new URLSearchParams({
    source: 'self-serve-demo',
    campaign: DEMO_44_REFERRAL_CAMPAIGN,
    offer: DEMO_44_TEAM_TRIAL_OFFER,
  });

  if (referralCode) {
    createMapParams.set('referralCode', referralCode);
  }

  return `/campaigns/create?${createMapParams.toString()}`;
}

async function buildTrackingProps(
  searchParams?: DemoFortyFourPageProps['searchParams']
) {
  const params = await searchParams;
  return {
    referralCode: normalizeSalespersonReferralCodeInput(
      firstParam(params?.referralCode ?? params?.ref)
    ),
    source: firstParam(params?.source),
    campaign:
      firstParam(params?.campaign) || DEMO_44_REFERRAL_CAMPAIGN,
    demoLinkToken: firstParam(params?.demoLink),
  };
}

export default async function DemoFortyFourPage({
  searchParams,
}: DemoFortyFourPageProps) {
  const tracking = await buildTrackingProps(searchParams);

  return (
    <DialerVideoLanding
      customerCode={DEMO_FORTY_FOUR_STREAM_CUSTOMER_CODE}
      videoUid={DEMO_FORTY_FOUR_STREAM_VIDEO_UID}
      posterUrl={
        process.env.NEXT_PUBLIC_DEMO_FORTY_FOUR_STREAM_POSTER_URL ||
        process.env.NEXT_PUBLIC_DEMO_THREE_STREAM_POSTER_URL
      }
      videoTitle="WolfGrid team lead demo"
      redirectAtSeconds={DEMO_FORTY_FOUR_CTA_AT_SECONDS}
      onboardingHref={await buildOnboardingHref(searchParams)}
      primaryCtaLabel="Start My Team's Free 90-Day Trial"
      founderCallHref={FOUNDER_CALL_HREF}
      endCtaEyebrow="Built for team leads"
      endCtaTitle="Give your whole team 90 days. All we ask is your feedback."
      showFounderCallButton={false}
      referralCode={tracking.referralCode}
      trackingSource={tracking.source}
      trackingCampaign={tracking.campaign}
      demoLinkToken={tracking.demoLinkToken}
    />
  );
}
