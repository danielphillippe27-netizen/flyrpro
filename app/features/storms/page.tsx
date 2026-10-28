import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, CloudLightning, MapPinned, Route } from 'lucide-react';
import { PublicSiteHeader } from '@/components/landing/PublicSiteHeader';
import { PublicSiteFooter } from '@/components/landing/PublicSiteFooter';

const description = 'Explore storm activity, choose an area, and turn your next move into a field campaign with WolfGrid Storms.';

export const metadata: Metadata = {
  title: 'Storms — From Storm Map to Field Campaign',
  description,
  alternates: { canonical: '/features/storms' },
  openGraph: {
    title: 'Find the storm. Plan your next move.',
    description,
    url: '/features/storms',
  },
};

const steps = [
  { icon: CloudLightning, title: 'See the storm activity.', copy: 'Explore hail and wind activity on the map to see where to focus your research.', image: '/landing/storms/storm-activity.webp', height: 2012, alt: 'WolfGrid Storm Maps showing estimated hail activity around El Paso and Ciudad Juárez.' },
  { icon: MapPinned, title: 'Choose your area.', copy: 'Review the storm footprint and select the territory your team wants to work.', image: '/landing/storms/area-selection.webp', height: 2020, alt: 'An outlined hail zone in WolfGrid with estimated hail intensity and an address count for the selected territory.' },
  { icon: Route, title: 'Take it to the field.', copy: 'Create a campaign and keep your addresses, conversations, and follow-ups together.', image: '/landing/storms/field-campaign.webp', height: 2004, alt: 'A WolfGrid campaign in Mississauga showing 1,040 addresses and a 3D neighborhood map.' },
];

export default function StormsFeaturePage() {
  return (
    <div className="min-h-screen bg-[#f7f5f2] text-zinc-950">
      <PublicSiteHeader active="storms" primaryAction={{ href: '#storm-demo', label: 'Watch demo' }} />
      <main>
        <section className="px-5 pb-14 pt-14 md:px-8 md:pb-20 md:pt-20">
          <div className="mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
            <div>
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-red-600">
                <CloudLightning className="h-4 w-4" aria-hidden="true" /> WolfGrid Storms
              </p>
              <h1 className="mt-6 text-5xl font-black leading-[1.02] tracking-[-0.055em] sm:text-6xl lg:text-7xl">
                Find the storm.<br /><span className="text-red-600">Plan your next move.</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-zinc-600">
                See storm activity. Choose your territory. Turn the map into a campaign your team can work.
              </p>
            </div>
            <div className="mx-auto w-full max-w-[340px]">
            <div id="storm-demo" className="scroll-mt-36 overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/15 md:scroll-mt-24">
              <iframe
                src="https://iframe.videodelivery.net/ad6fbe3e521a550ac1a276c1a34f1a14?controls=true&preload=metadata"
                title="WolfGrid Storms demo — from storm map to field campaign"
                className="block aspect-[9/16] w-full border-0"
                allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            </div>
            <p className="mt-5 text-center text-sm text-zinc-500">Watch WolfGrid Storms in action.</p>
            <div className="mt-6 flex justify-center">
              <Link href="/login" className="inline-flex h-13 items-center justify-center rounded-full bg-red-600 px-7 text-sm font-bold text-white transition hover:bg-red-700">
                Start your first campaign <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
            </div>
          </div>
        </section>
        <section className="bg-[#111] px-5 py-16 text-white md:px-8 md:py-20">
          <div className="mx-auto max-w-7xl">
            <h2 className="max-w-2xl text-3xl font-black leading-tight tracking-[-0.04em] md:text-5xl">From storm activity<br />to a plan for your team.</h2>
            <div className="mt-12 grid gap-9 md:grid-cols-3 md:gap-10">
              {steps.map(({ icon: Icon, title, copy, image, height, alt }) => (
                <div key={title} className="border-t border-white/20 pt-6">
                  <a href={image} target="_blank" rel="noopener noreferrer" className="mb-6 block overflow-hidden rounded-xl border border-white/15 transition hover:border-white/40 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-red-500" aria-label={`Enlarge screenshot: ${title}`}>
                    <Image src={image} alt={alt} width={3600} height={height} sizes="(min-width: 1280px) 400px, (min-width: 768px) 33vw, 100vw" className="h-auto w-full" />
                  </a>
                  <Icon className="h-7 w-7 text-red-500" aria-hidden="true" />
                  <h3 className="mt-5 text-xl font-bold">{title}</h3>
                  <p className="mt-3 max-w-sm text-base leading-7 text-zinc-400">{copy}</p>
                </div>
              ))}
            </div>
            <p className="mt-12 max-w-3xl text-xs leading-6 text-zinc-500">Storm data indicates reported or estimated weather activity, not confirmed property damage. Coverage and available detail vary by location and data source.</p>
          </div>
        </section>
      </main>
      <PublicSiteFooter />
    </div>
  );
}
