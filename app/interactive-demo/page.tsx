import type { Metadata } from 'next';
import { siteVideo } from '@/lib/demo/siteVideos';
import { Demo100Experience } from '@/components/demo100/Demo100Experience';

export const metadata: Metadata = {
  title: 'Interactive Team Demo',
  description: 'Build a real WolfGrid territory, assign a team, and watch the campaign come alive.',
  alternates: { canonical: '/interactive-demo' },
  openGraph: {
    title: 'WolfGrid Interactive Team Demo',
    description: 'Build a territory, assign a team, and watch field results update live.',
    url: 'https://wolfgrid.app/interactive-demo',
    images: ['/opengraph-image'],
  },
};

type DemoOnePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export default async function DemoOnePage({ searchParams }: DemoOnePageProps) {
  const params = await searchParams;
  return (
    <Demo100Experience
      videos={{
        intro: siteVideo('interactive-intro', process.env.NEXT_PUBLIC_DEMO1_INTRO_VIDEO_URL),
        postCreate: siteVideo(
          'interactive-post-create',
          process.env.NEXT_PUBLIC_DEMO1_POST_CREATE_VIDEO_URL || process.env.NEXT_PUBLIC_DEMO100_POST_CREATE_VIDEO_URL,
        ),
        fieldGuideIntro: siteVideo(
          'field-guide-intro',
          process.env.NEXT_PUBLIC_DEMO1_FIELD_GUIDE_INTRO_VIDEO_URL || process.env.NEXT_PUBLIC_DEMO100_FIELD_GUIDE_INTRO_VIDEO_URL,
        ),
        iphone: siteVideo(
          'iphone-field-guide',
          process.env.NEXT_PUBLIC_DEMO1_IPHONE_VIDEO_URL || process.env.NEXT_PUBLIC_DEMO100_IPHONE_VIDEO_URL,
        ),
        outro: siteVideo(
          'demo-outro',
          process.env.NEXT_PUBLIC_DEMO1_OUTRO_VIDEO_URL || process.env.NEXT_PUBLIC_DEMO100_OUTRO_VIDEO_URL,
        ),
        team: siteVideo(
          'interactive-team',
          process.env.NEXT_PUBLIC_DEMO1_TEAM_VIDEO_URL || process.env.NEXT_PUBLIC_DEMO100_TEAM_VIDEO_URL,
        ),
        solo: siteVideo(
          'interactive-solo',
          process.env.NEXT_PUBLIC_DEMO1_SOLO_VIDEO_URL || process.env.NEXT_PUBLIC_DEMO100_SOLO_VIDEO_URL,
        ),
        magic: siteVideo(
          'interactive-magic',
          process.env.NEXT_PUBLIC_DEMO1_MAGIC_VIDEO_URL || process.env.NEXT_PUBLIC_DEMO100_MAGIC_VIDEO_URL,
        ),
        end: siteVideo('interactive-end', process.env.NEXT_PUBLIC_DEMO1_END_VIDEO_URL),
      }}
      founderCallHref={process.env.NEXT_PUBLIC_FOUNDER_CALL_URL || 'https://calendly.com/daniel-phillippe'}
      referralCode={first(params?.referralCode ?? params?.ref)}
      variant="demo1"
    />
  );
}
