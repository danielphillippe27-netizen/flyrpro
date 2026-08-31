import type { Metadata, Viewport } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, BadgeCheck } from 'lucide-react';
import { normalizeSalespersonReferralCodeInput } from '@/app/lib/billing/salespeople';

export const metadata: Metadata = {
  title: 'Free 3D Prospecting Map',
  description:
    'Pick a neighborhood, select up to 1,000 homes, and launch a free 3D prospecting campaign with WolfGrid.',
  alternates: { canonical: '/free' },
  openGraph: {
    title: 'Build your first 3D prospecting map free',
    description:
      'Pick a neighborhood, watch the map fill in, and test a live field campaign.',
    url: 'https://wolfgrid.app/free',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Build your first 3D prospecting map free',
    description: 'Pick a neighborhood and watch WolfGrid turn it into a live campaign.',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#09090b',
};

type FreePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

async function buildCampaignHref(searchParams?: FreePageProps['searchParams']) {
  const params = await searchParams;
  const referralCode = normalizeSalespersonReferralCodeInput(
    firstParam(params?.referralCode ?? params?.ref),
  );
  const campaignParams = new URLSearchParams({
    source: 'self-serve-demo',
    campaign: 'self-serve-campaign',
  });

  if (referralCode) campaignParams.set('referralCode', referralCode);
  return `/campaigns/create?${campaignParams.toString()}`;
}

export default async function FreeProspectingMapPage({ searchParams }: FreePageProps) {
  const campaignHref = await buildCampaignHref(searchParams);

  return (
    <main className="min-h-svh overflow-hidden bg-[#08090b] text-white selection:bg-red-500">
      <div className="pointer-events-none fixed inset-0" aria-hidden="true">
        <div className="absolute -left-24 -top-28 size-80 rounded-full bg-red-600/20 blur-[100px]" />
        <div className="absolute -right-36 bottom-0 size-96 rounded-full bg-orange-500/10 blur-[120px]" />
      </div>

      <div className="relative mx-auto flex min-h-svh w-full max-w-6xl flex-col px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 lg:px-8">
        <header className="flex items-center justify-between py-2">
          <Link href="/" aria-label="WolfGrid home">
            <Image
              src="/brand/wolfgrid-header-dark.svg"
              alt="WolfGrid"
              width={1900}
              height={250}
              priority
              className="h-auto w-40 object-contain object-left sm:w-48"
            />
          </Link>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/15 bg-emerald-400/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-200">
            <BadgeCheck className="size-3.5" /> Free to build
          </span>
        </header>

        <section className="grid flex-1 items-center gap-8 py-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14 lg:py-14">
          <div className="text-center lg:text-left">
            <h1 className="mx-auto max-w-2xl text-balance text-[3.15rem] font-black leading-[0.91] tracking-[-0.065em] sm:text-6xl lg:mx-0 lg:text-7xl">
              Press here to build your 3D prospecting map.
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-pretty text-base font-medium leading-7 text-zinc-300 sm:text-lg lg:mx-0">
              Pick a neighborhood, choose up to 1,000 homes, watch your map fill in, then test what it feels like to work the doors.
            </p>

            <Link
              href={campaignHref}
              className="group mt-7 inline-flex min-h-16 w-full items-center justify-center rounded-2xl bg-red-500 px-6 text-base font-black text-white shadow-[0_18px_55px_rgba(239,68,68,0.34)] transition hover:bg-red-400 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-300/40 sm:w-auto sm:min-w-80"
            >
              Build my free 3D map
              <ArrowRight className="ml-2 size-5 transition-transform group-hover:translate-x-1" />
            </Link>
            <p className="mt-3 text-xs font-semibold text-zinc-500">No credit card · Start before creating an account</p>
          </div>

          <div className="relative mx-auto w-full max-w-xl">
            <div className="absolute -inset-3 rounded-[2.25rem] bg-gradient-to-br from-red-500/30 via-transparent to-orange-400/15 blur-2xl" />
            <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-zinc-900 p-2 shadow-[0_36px_100px_rgba(0,0,0,0.6)]">
              <div className="relative aspect-[4/5] overflow-hidden rounded-[1.6rem] bg-black sm:aspect-[5/4] lg:aspect-[4/5]">
                <Image
                  src="/onboarding-create-campaign.png"
                  alt="A neighborhood selected for a WolfGrid 3D prospecting map"
                  fill
                  priority
                  sizes="(max-width: 640px) calc(100vw - 48px), (max-width: 1024px) 576px, 45vw"
                  className="object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/85" />

                <div className="absolute left-4 right-4 top-4 flex items-center justify-between gap-3">
                  <span className="rounded-xl border border-white/15 bg-black/60 px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] backdrop-blur-xl">
                    Live 3D territory
                  </span>
                  <span className="rounded-xl border border-white/15 bg-black/60 px-3 py-2 text-xs font-black text-emerald-300 backdrop-blur-xl">
                    $0
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
