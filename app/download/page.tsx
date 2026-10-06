import Image from 'next/image';
import { Check } from 'lucide-react';
import { PublicSiteFooter } from '@/components/landing/PublicSiteFooter';
import { PublicSiteHeader } from '@/components/landing/PublicSiteHeader';

const appStoreUrl = 'https://apps.apple.com/ca/app/wolfgrid/id6755614702';
const googlePlayUrl = 'https://play.google.com/store/apps/details?id=app.wolfgrid.android';

export default function DownloadPage() {
  return (
    <div className="min-h-screen bg-[#f7f5f2] text-zinc-950">
      <PublicSiteHeader active="download" />

      <main>
        <section className="relative overflow-hidden px-5 pb-16 pt-20 md:px-8 md:pb-24 md:pt-28">
          <div className="pointer-events-none absolute -right-48 top-0 h-[560px] w-[560px] rounded-full bg-red-500/10 blur-[110px]" />
          <div className="relative mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[1fr_0.82fr]">
            <div>
              <h1 className=" max-w-3xl text-5xl font-black leading-[0.96] tracking-[-0.055em] md:text-7xl">
                Prospecting like you’ve never seen before.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-8 text-zinc-600">
                Follow the route, record every door, capture leads, and keep the campaign moving while you are in the field.
              </p>
              <ul className="mt-8 grid gap-3 text-sm font-semibold text-zinc-700 sm:grid-cols-2">
                {['Live campaign maps', 'Door-by-door outcomes', 'Leads and follow-ups', 'Progress that syncs to desktop'].map((item) => (
                  <li key={item} className="flex items-center gap-2.5">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-red-600">
                      <Check className="h-3 w-3" />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>

              <div className="mt-10 flex flex-wrap items-center gap-4">
                <a href={appStoreUrl} target="_blank" rel="noreferrer" aria-label="Download on the App Store" className="rounded-lg transition hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-red-600">
                  <Image src="/landing/app-store-badge.svg" alt="Download on the App Store" width={180} height={60} className="h-[60px] w-auto" />
                </a>
                <a href={googlePlayUrl} target="_blank" rel="noreferrer" aria-label="Get it on Google Play" className="rounded-lg transition hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-red-600">
                  <Image src="/landing/google-play-badge.png" alt="Get it on Google Play" width={224} height={87} className="-my-3 h-[87px] w-auto" />
                </a>
              </div>
            </div>

            <div className="relative mx-auto w-[260px] rounded-[3rem] border-[3px] border-zinc-500 bg-zinc-950 p-2 shadow-2xl sm:w-[290px]">
              <div className="absolute -left-[5px] top-32 h-10 w-[3px] rounded-l bg-zinc-600" aria-hidden="true" />
              <div className="absolute -right-[5px] top-36 h-14 w-[3px] rounded-r bg-zinc-600" aria-hidden="true" />
              <div className="relative overflow-hidden rounded-[2.4rem]">
                <Image src="/landing/download-iphone-map.png" alt="WolfGrid iPhone campaign map with numbered homes, property outlines, and green and red door results" width={1206} height={2622} priority sizes="290px" className="block h-auto w-full" />
                <div className="absolute left-1/2 top-2 h-4 w-20 -translate-x-1/2 rounded-full bg-black" aria-hidden="true" />
                <div className="absolute bottom-2 left-1/2 h-1 w-24 -translate-x-1/2 rounded-full bg-white/80" aria-hidden="true" />
              </div>
            </div>
          </div>
        </section>

      </main>

      <PublicSiteFooter />
    </div>
  );
}
