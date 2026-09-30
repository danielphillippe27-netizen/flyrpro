import type { Metadata } from 'next';
import { Demo100Experience } from '@/components/demo100/Demo100Experience';

export const metadata: Metadata = {
  title: 'Interactive Team Demo',
  description: 'Build a real WolfGrid territory, assign a team, and watch the campaign come alive.',
  alternates: { canonical: '/demo1' },
  openGraph: {
    title: 'WolfGrid Interactive Team Demo',
    description: 'Build a territory, assign a team, and watch field results update live.',
    url: 'https://wolfgrid.app/demo1',
    images: ['/opengraph-image'],
  },
};

type DemoOnePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function demo1VideoUid(demo1EnvName: string, demo100EnvName: string, fallback: string) {
  return process.env[demo1EnvName] || process.env[demo100EnvName] || fallback;
}

export default async function DemoOnePage({ searchParams }: DemoOnePageProps) {
  const params = await searchParams;
  const iphoneOverviewUid = demo1VideoUid(
    'NEXT_PUBLIC_DEMO1_IPHONE_STREAM_VIDEO_UID',
    'NEXT_PUBLIC_DEMO100_IPHONE_STREAM_VIDEO_UID',
    '667f3cc919bb749d35801c545fbf0ec5',
  );

  return (
    <Demo100Experience
      customerCode={process.env.NEXT_PUBLIC_CLOUDFLARE_STREAM_CUSTOMER_CODE}
      videoUids={{
        intro: demo1VideoUid(
          'NEXT_PUBLIC_DEMO1_INTRO_STREAM_VIDEO_UID',
          'NEXT_PUBLIC_DEMO100_INTRO_STREAM_VIDEO_UID',
          '98f73fd9a8262141c491d508bee8e620',
        ),
        postCreate: demo1VideoUid(
          'NEXT_PUBLIC_DEMO1_POST_CREATE_STREAM_VIDEO_UID',
          'NEXT_PUBLIC_DEMO100_POST_CREATE_STREAM_VIDEO_UID',
          'abe827017c08f0d40dd57d84ca88bf8c',
        ),
        fieldGuideIntro: demo1VideoUid(
          'NEXT_PUBLIC_DEMO1_FIELD_GUIDE_INTRO_STREAM_VIDEO_UID',
          'NEXT_PUBLIC_DEMO100_FIELD_GUIDE_INTRO_STREAM_VIDEO_UID',
          'c0872931ae8d5c162b3387c56bc5ce67',
        ),
        iphone: iphoneOverviewUid,
        outro: demo1VideoUid(
          'NEXT_PUBLIC_DEMO1_OUTRO_STREAM_VIDEO_UID',
          'NEXT_PUBLIC_DEMO100_OUTRO_STREAM_VIDEO_UID',
          '751b31f589947a56f250585bd93d9e82',
        ),
        team: demo1VideoUid(
          'NEXT_PUBLIC_DEMO1_TEAM_STREAM_VIDEO_UID',
          'NEXT_PUBLIC_DEMO100_TEAM_STREAM_VIDEO_UID',
          '562f1c79a5db940327f32588978bbb33',
        ),
        solo: demo1VideoUid(
          'NEXT_PUBLIC_DEMO1_SOLO_STREAM_VIDEO_UID',
          'NEXT_PUBLIC_DEMO100_SOLO_STREAM_VIDEO_UID',
          'a28d08cb98f3202d4d270e3feb1d1017',
        ),
        magic: demo1VideoUid(
          'NEXT_PUBLIC_DEMO1_MAGIC_STREAM_VIDEO_UID',
          'NEXT_PUBLIC_DEMO100_MAGIC_STREAM_VIDEO_UID',
          '50e2ff07612338e37cf17adb68c0c81d',
        ),
        end: demo1VideoUid(
          'NEXT_PUBLIC_DEMO1_END_STREAM_VIDEO_UID',
          'NEXT_PUBLIC_DEMO100_END_STREAM_VIDEO_UID',
          '868eded9898942d896066b7ebbd8fac7',
        ),
      }}
      founderCallHref={process.env.NEXT_PUBLIC_FOUNDER_CALL_URL || 'https://calendly.com/daniel-phillippe'}
      referralCode={first(params?.referralCode ?? params?.ref)}
      variant="demo1"
    />
  );
}
