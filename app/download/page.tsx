import Link from 'next/link';
import { AppWindow, ArrowRight, Check, QrCode, Smartphone } from 'lucide-react';
import { MediaPlaceholder } from '@/components/landing/MediaPlaceholder';
import { PublicSiteFooter } from '@/components/landing/PublicSiteFooter';
import { PublicSiteHeader } from '@/components/landing/PublicSiteHeader';

const appStoreUrl = 'https://apps.apple.com/ca/app/wolfgrid/id6755614702';
const googlePlayUrl = 'https://play.google.com/store/apps/details?id=app.wolfgrid.android';

export default function DownloadPage() {
  return (
    <div className="min-h-screen bg-[#f7f5f2] text-zinc-950">
      <PublicSiteHeader active="download" />

      <main>
        <section className="relative overflow-hidden px-5 py-16 md:px-8 md:py-24">
          <div className="pointer-events-none absolute -right-48 top-0 h-[560px] w-[560px] rounded-full bg-red-500/10 blur-[110px]" />
          <div className="relative mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[1fr_0.82fr]">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-red-700">
                <Smartphone className="h-3.5 w-3.5" /> WolfGrid for iOS + Android
              </p>
              <h1 className="mt-7 max-w-3xl text-5xl font-black leading-[0.96] tracking-[-0.055em] md:text-7xl">
                Take the whole territory with you.
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

              <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <a
                  href={appStoreUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-13 items-center justify-center rounded-full bg-zinc-950 px-7 text-sm font-bold text-white transition hover:bg-red-600"
                >
                  Download on iOS <ArrowRight className="ml-2 h-4 w-4" />
                </a>
                <a
                  href={googlePlayUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-13 items-center justify-center rounded-full bg-zinc-950 px-7 text-sm font-bold text-white transition hover:bg-red-600"
                >
                  Get it on Google Play <ArrowRight className="ml-2 h-4 w-4" />
                </a>
                <Link
                  href="/login"
                  className="inline-flex h-13 items-center justify-center rounded-full border border-zinc-300 bg-white px-7 text-sm font-bold text-zinc-900 transition hover:border-zinc-950"
                >
                  Open desktop app
                </Link>
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-lg px-7 sm:px-12">
              <MediaPlaceholder
                label="Mobile app video"
                detail="iOS or Android · vertical route and door result recording"
                kind="video"
                className="mx-auto aspect-[9/16] min-h-0 max-w-[330px] rounded-[3rem] border-[8px] border-zinc-950"
              />
              <div className="absolute bottom-10 right-0 hidden rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl sm:block">
                <div className="flex gap-3">
                  <div className="text-center">
                    <QrCode className="h-12 w-12 text-zinc-950" />
                    <p className="mt-2 text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-500">iOS QR</p>
                  </div>
                  <div className="border-l border-zinc-200 pl-3 text-center">
                    <QrCode className="h-12 w-12 text-zinc-950" />
                    <p className="mt-2 text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-500">Android QR</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-zinc-950 px-5 py-20 text-white md:px-8 md:py-28">
          <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-2 lg:items-center">
            <MediaPlaceholder
              label="Desktop dashboard screenshot"
              detail="Campaign overview, map, progress, and team activity"
              className="aspect-[16/10] min-h-0 border-white/10"
            />
            <div>
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-600">
                <AppWindow className="h-5 w-5" />
              </span>
              <p className="mt-8 text-xs font-bold uppercase tracking-[0.2em] text-red-500">WolfGrid on desktop</p>
              <h2 className="mt-4 text-4xl font-black leading-[1.02] tracking-[-0.04em] md:text-6xl">
                Plan at the desk. Execute in the field.
              </h2>
              <p className="mt-6 max-w-xl text-lg leading-8 text-zinc-400">
                Use the desktop dashboard to build campaigns, assign territories, monitor progress, and organize everything that comes next.
              </p>
              <Link href="/login" className="mt-8 inline-flex h-12 items-center justify-center rounded-full bg-white px-7 text-sm font-bold text-zinc-950 transition hover:bg-zinc-200">
                Sign in on desktop <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>

        <section className="px-5 py-20 md:px-8 md:py-28">
          <div className="mx-auto max-w-5xl text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-red-600">One connected workflow</p>
            <h2 className="mt-4 text-4xl font-black tracking-[-0.04em] md:text-6xl">Your work stays with you.</h2>
            <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-zinc-600">
              Start the campaign on desktop, carry it into the neighbourhood, and return with every result already organized.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <a href={appStoreUrl} target="_blank" rel="noreferrer" className="inline-flex h-13 items-center justify-center rounded-full bg-red-600 px-7 text-sm font-bold text-white transition hover:bg-red-500">
                Download on iOS <ArrowRight className="ml-2 h-4 w-4" />
              </a>
              <a href={googlePlayUrl} target="_blank" rel="noreferrer" className="inline-flex h-13 items-center justify-center rounded-full bg-zinc-950 px-7 text-sm font-bold text-white transition hover:bg-zinc-800">
                Get it on Google Play <ArrowRight className="ml-2 h-4 w-4" />
              </a>
            </div>
          </div>
        </section>
      </main>

      <PublicSiteFooter />
    </div>
  );
}
