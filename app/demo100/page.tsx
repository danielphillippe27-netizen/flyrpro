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
  return (
    <Demo100Experience
      customerCode={process.env.NEXT_PUBLIC_CLOUDFLARE_STREAM_CUSTOMER_CODE}
      videoUids={{
        intro:
          process.env.NEXT_PUBLIC_DEMO100_INTRO_STREAM_VIDEO_UID ||
          'c06bf98bd6326b2f10ef24b7afc513e4',
        postCreate:
          process.env.NEXT_PUBLIC_DEMO100_POST_CREATE_STREAM_VIDEO_UID ||
          '9063c07d0d4b025860da4aef80836b96',
        iphone:
          process.env.NEXT_PUBLIC_DEMO100_IPHONE_STREAM_VIDEO_UID ||
          '5d4fd4faa2442490d0af9cc74301eed9',
        outro:
          process.env.NEXT_PUBLIC_DEMO100_OUTRO_STREAM_VIDEO_UID ||
          '19081db624eb8d57a0d1a85cc595df1d',
      }}
      founderCallHref={process.env.NEXT_PUBLIC_FOUNDER_CALL_URL || 'https://calendly.com/daniel-phillippe'}
      referralCode={first(params?.referralCode ?? params?.ref)}
    />
  );
}
