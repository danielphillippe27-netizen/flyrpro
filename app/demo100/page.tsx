import type { Metadata } from 'next';
import { Demo100Experience } from '@/components/demo100/Demo100Experience';

export const metadata: Metadata = {
  title: 'Interactive Team Demo',
  description: 'Build a real WolfGrid territory, assign a team, and watch the campaign come alive.',
  alternates: { canonical: '/demo100' },
  openGraph: {
    title: 'WolfGrid Interactive Team Demo',
    description: 'Build a territory, assign a team, and watch field results update live.',
    url: 'https://wolfgrid.app/demo100',
    images: ['/opengraph-image'],
  },
};

type Demo100PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export default async function Demo100Page({ searchParams }: Demo100PageProps) {
  const params = await searchParams;
  const iphoneOverviewUid =
    process.env.NEXT_PUBLIC_DEMO100_IPHONE_STREAM_VIDEO_UID ||
    '667f3cc919bb749d35801c545fbf0ec5';
  return (
    <Demo100Experience
      customerCode={process.env.NEXT_PUBLIC_CLOUDFLARE_STREAM_CUSTOMER_CODE}
      videoUids={{
        intro:
          process.env.NEXT_PUBLIC_DEMO100_INTRO_STREAM_VIDEO_UID ||
          '219a76af1242024f971f926831a01059',
        postCreate:
          process.env.NEXT_PUBLIC_DEMO100_POST_CREATE_STREAM_VIDEO_UID ||
          'fbc8bc2dcb7b96baf1a229b9397f12a8',
        fieldGuideIntro:
          process.env.NEXT_PUBLIC_DEMO100_FIELD_GUIDE_INTRO_STREAM_VIDEO_UID ||
          'c0872931ae8d5c162b3387c56bc5ce67',
        iphone:
          iphoneOverviewUid,
        outro:
          process.env.NEXT_PUBLIC_DEMO100_OUTRO_STREAM_VIDEO_UID ||
          '751b31f589947a56f250585bd93d9e82',
      }}
      founderCallHref={process.env.NEXT_PUBLIC_FOUNDER_CALL_URL || 'https://calendly.com/daniel-phillippe'}
      referralCode={first(params?.referralCode ?? params?.ref)}
    />
  );
}
