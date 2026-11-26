import type { Metadata } from 'next';
import { siteVideo } from '@/lib/demo/siteVideos';
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
  return (
    <Demo100Experience
      videos={{
        intro: {
          ...siteVideo('demo100-intro', process.env.NEXT_PUBLIC_DEMO100_INTRO_VIDEO_URL),
          captions: process.env.NEXT_PUBLIC_DEMO100_INTRO_VIDEO_URL ? undefined : '/media/demo100-intro.en.vtt',
        },
        postCreate: siteVideo('demo100-post-create', process.env.NEXT_PUBLIC_DEMO100_POST_CREATE_VIDEO_URL),
        fieldGuideIntro: siteVideo('field-guide-intro', process.env.NEXT_PUBLIC_DEMO100_FIELD_GUIDE_INTRO_VIDEO_URL),
        iphone: siteVideo('iphone-field-guide', process.env.NEXT_PUBLIC_DEMO100_IPHONE_VIDEO_URL),
        outro: siteVideo('demo-outro', process.env.NEXT_PUBLIC_DEMO100_OUTRO_VIDEO_URL),
      }}
      founderCallHref={process.env.NEXT_PUBLIC_FOUNDER_CALL_URL || 'https://calendly.com/daniel-phillippe'}
      referralCode={first(params?.referralCode ?? params?.ref)}
    />
  );
}
