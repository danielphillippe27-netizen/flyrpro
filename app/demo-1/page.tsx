import type { Metadata } from 'next';
import { DialerVideoLanding } from '../power-dialer/DialerVideoLanding';

const ONBOARDING_HREF = '/onboarding?source=dialer&campaign=power-dialer';
const DEFAULT_DIALER_VIDEO_URL = 'https://d34c49t0gfk0ai.cloudfront.net/demo-video/demo-video.mp4';
const DIALER_VIDEO_REDIRECT_AT_SECONDS = 85;

export const metadata: Metadata = {
  title: 'Demo 1 | FLYR',
  description: 'Watch the FLYR demo and start a 14 day free trial. No credit card.',
  openGraph: {
    title: 'FLYR Demo 1',
    description: 'Watch the demo and start a 14 day free trial. No credit card.',
    url: 'https://flyr.software/demo-1',
  },
};

export default function DemoOnePage() {
  return (
    <DialerVideoLanding
      videoUrl={process.env.NEXT_PUBLIC_DIALER_VIDEO_URL || DEFAULT_DIALER_VIDEO_URL}
      customerCode={process.env.NEXT_PUBLIC_CLOUDFLARE_STREAM_CUSTOMER_CODE}
      videoUid={process.env.NEXT_PUBLIC_DIALER_STREAM_VIDEO_UID}
      posterUrl={process.env.NEXT_PUBLIC_DIALER_STREAM_POSTER_URL}
      onboardingHref={ONBOARDING_HREF}
      redirectAtSeconds={DIALER_VIDEO_REDIRECT_AT_SECONDS}
    />
  );
}
