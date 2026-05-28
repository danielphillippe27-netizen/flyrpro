import Link from 'next/link';
import { AMBASSADOR_LANDING_DEFAULTS, buildAmbassadorSharePath } from '@/app/lib/ambassador/portal';
import type { PublicAmbassadorLandingPage } from '@/app/lib/ambassador/public-landing';

type PublicAmbassadorLandingProps = {
  landingPage: PublicAmbassadorLandingPage;
  source?: string;
  campaign?: string;
};

function isVideoUrl(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes('youtube.com') ||
    normalized.includes('youtu.be') ||
    normalized.includes('vimeo.com') ||
    normalized.endsWith('.mp4') ||
    normalized.endsWith('.webm') ||
    normalized.endsWith('.mov')
  );
}

function isDirectVideoUrl(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized.endsWith('.mp4') || normalized.endsWith('.webm') || normalized.endsWith('.mov');
}

export function PublicAmbassadorLanding({
  landingPage,
  source,
  campaign,
}: PublicAmbassadorLandingProps) {
  const displayName = landingPage.display_name || landingPage.ambassador.full_name;
  const mediaUrl = landingPage.hero_video_url || landingPage.profile_image_url || '';
  const ctaPath = buildAmbassadorSharePath(
    landingPage.ambassador.referral_code,
    source || 'landing_page',
    campaign || landingPage.slug
  );

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <section className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center gap-8 px-5 py-10 md:px-8">
        <div className="space-y-3">
          <p className="text-sm font-semibold uppercase tracking-[0.08em] text-red-400">
            FLYR Partner / {displayName}
          </p>
          <h1 className="max-w-4xl text-4xl font-semibold tracking-normal md:text-6xl">
            {landingPage.headline || AMBASSADOR_LANDING_DEFAULTS.headline}
          </h1>
          <p className="max-w-3xl text-lg leading-8 text-zinc-300 md:text-xl">
            {landingPage.intro_message || AMBASSADOR_LANDING_DEFAULTS.subline}
          </p>
        </div>

        <div className="overflow-hidden rounded-md border border-white/10 bg-zinc-900">
          {mediaUrl ? (
            isDirectVideoUrl(mediaUrl) ? (
              <video src={mediaUrl} className="aspect-video w-full object-cover" controls playsInline />
            ) : isVideoUrl(mediaUrl) ? (
              <iframe
                src={mediaUrl}
                title="FLYR demo"
                className="aspect-video w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={mediaUrl}
                alt="FLYR partner media"
                className="aspect-video w-full object-cover"
              />
            )
          ) : (
            <div className="flex aspect-video items-center justify-center px-8 text-center">
              <div>
                <p className="text-2xl font-semibold">FLYR field prospecting</p>
                <p className="mt-3 max-w-md text-sm leading-6 text-zinc-400">
                  Map territories, track doors, organize follow-up, and make field activity measurable.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <p className="max-w-3xl text-xl leading-8 text-zinc-100">
            {landingPage.offer_text || AMBASSADOR_LANDING_DEFAULTS.offerText}
          </p>
          <Link
            href={ctaPath}
            className="inline-flex min-h-12 items-center rounded-md bg-red-500 px-6 text-sm font-semibold text-white transition-colors hover:bg-red-600"
          >
            Start 14 day free trial
          </Link>
        </div>
      </section>
    </main>
  );
}
