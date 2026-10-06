'use client';

import { useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Play,
} from 'lucide-react';
import { PublicSiteFooter } from '@/components/landing/PublicSiteFooter';
import { PublicSiteHeader } from '@/components/landing/PublicSiteHeader';

export default function LandingPage() {
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error');
    const errorCode = params.get('error_code');
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
    const fragment = new URLSearchParams(hash);
    const type = params.get('type') ?? fragment.get('type');
    const hasRecoverySignal = ['code', 'token', 'token_hash', 'access_token', 'refresh_token'].some(
      (key) => params.has(key) || fragment.has(key),
    );

    if (type === 'recovery' || hasRecoverySignal) {
      const resetUrl = new URL('/reset-password', window.location.origin);
      resetUrl.search = window.location.search;
      resetUrl.hash = window.location.hash;
      router.replace(`${resetUrl.pathname}${resetUrl.search}${resetUrl.hash}`);
      return;
    }

    if (code) {
      const callbackURL = new URL('/auth/callback', window.location.origin);
      callbackURL.search = params.toString();
      if (!callbackURL.searchParams.has('next')) callbackURL.searchParams.set('next', '/home');
      router.replace(`${callbackURL.pathname}${callbackURL.search}`);
      return;
    }

    if (error === 'access_denied' && errorCode) {
      const loginURL = new URL('/login', window.location.origin);
      loginURL.searchParams.set('error', errorCode === 'otp_expired' ? 'reset_link_invalid' : 'auth_failed');
      router.replace(`${loginURL.pathname}${loginURL.search}`);
    }
  }, [router]);

  return (
    <div className="min-h-screen bg-[#f7f5f2] text-zinc-950">
      <PublicSiteHeader showAmbassador={false} primaryAction={{ href: "/demo1?start=fresh", label: "Interactive demo" }} />

      <main>
        <section className="px-5 py-12 md:px-8 lg:py-12">
          <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-12">
            <div>
              <h1 className=" text-5xl font-black leading-[0.98] tracking-[-0.055em] sm:text-6xl xl:text-7xl">
                The World’s First<span className="mt-1 block">3D Prospecting System</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-zinc-600">
                The territory and door-to-door sales app that keeps your map, your team, and your follow-ups together.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/demo1?start=fresh" className="inline-flex h-13 items-center justify-center rounded-full bg-red-600 px-7 text-sm font-bold text-white transition hover:bg-red-700">
                  Interactive demo <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </div>
            </div>
            <div className="relative flex min-h-[480px] items-center justify-center py-7 sm:min-h-[520px] lg:h-[530px]">
              <div className="relative w-[218px] rounded-[2.8rem] border-[3px] border-zinc-500 bg-zinc-950 p-[7px] shadow-[0_24px_48px_-12px_rgba(0,0,0,0.45)] sm:w-[232px] lg:w-[238px]">
                <div className="absolute -left-[5px] top-24 h-6 w-[3px] rounded-l bg-zinc-600" aria-hidden="true" />
                <div className="absolute -left-[5px] top-36 h-10 w-[3px] rounded-l bg-zinc-600" aria-hidden="true" />
                <div className="absolute -right-[5px] top-32 h-14 w-[3px] rounded-r bg-zinc-600" aria-hidden="true" />
                <div className="relative overflow-hidden rounded-[2.2rem]">
                  <Image src="/landing/hero-iphone-map.png" alt="WolfGrid on iPhone showing a 3D neighborhood map with green and red buildings and outlined properties" width={1206} height={2622} priority sizes="238px" className="block h-auto w-full" />
                  <div className="absolute left-1/2 top-2 h-4 w-16 -translate-x-1/2 rounded-full bg-black" aria-hidden="true" />
                  <div className="absolute bottom-2 left-1/2 h-1 w-20 -translate-x-1/2 rounded-full bg-white/80" aria-hidden="true" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-zinc-200 bg-white px-5 py-6 md:px-8">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 md:flex-row">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">For people who prospect in person</p>
            <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm font-bold text-zinc-800">
              {['Roofing', 'Solar', 'Pest control', 'Real estate', 'Windows', 'Landscaping', 'Politics'].map((industry) => <span key={industry}>{industry}</span>)}
            </div>
          </div>
        </section>

        <section id="product" className="scroll-mt-24 bg-[#111] px-5 py-16 text-white md:px-8 md:py-20">
          <div id="workflow" className="mx-auto max-w-7xl scroll-mt-24">
            <div className="grid gap-6 md:grid-cols-2 md:items-end">
              <div>
                <h2 className="mt-4 text-4xl font-black leading-[1.05] tracking-[-0.04em] md:text-5xl">A territory is more than<br />pins on a map.</h2>
              </div>
              <p className="max-w-lg text-lg leading-8 text-zinc-400">Explore your campaign in 3D. Keep addresses and activity in one view, so you can see where to work and where to return.</p>
            </div>
            <Link href="/demo1?start=fresh" aria-label="Play the WolfGrid interactive demo" className="group relative mt-9 block overflow-hidden rounded-2xl border border-white/15 bg-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-red-500">
              <Image src="/landing/interactive-demo-cover.png" alt="WolfGrid 3D neighborhood map with color-coded campaign results" width={2622} height={1206} sizes="(min-width: 1280px) 1280px, 100vw" className="h-auto w-full" />
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/15 transition group-hover:bg-black/25">
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white shadow-xl transition group-hover:scale-110 group-hover:bg-red-500 sm:h-24 sm:w-24">
                  <Play className="ml-1 h-7 w-7 fill-current sm:h-10 sm:w-10" aria-hidden="true" />
                </span>
                <span className="rounded-full bg-black/80 px-5 py-2 text-sm font-bold text-white sm:text-base">Launch interactive demo</span>
              </div>
            </Link>
          </div>
        </section>

        <section className="bg-red-600 px-5 py-16 text-white md:px-8 md:py-20">
          <div className="mx-auto flex max-w-7xl flex-col justify-between gap-8 lg:flex-row lg:items-center">
            <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-white/80">Try it for yourself</p><h2 className="mt-4 text-4xl font-black leading-[1.05] tracking-[-0.04em] md:text-5xl">Put your next territory<br />on the grid.</h2><p className="mt-5 text-base text-white/90">Explore WolfGrid in the interactive demo, then start your first campaign free.</p></div>
            <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
              <Link href="/demo1?start=fresh" className="inline-flex h-13 items-center justify-center rounded-full bg-white px-8 text-sm font-bold text-zinc-950 transition hover:bg-zinc-100">Interactive demo <ArrowRight className="ml-2 h-4 w-4" /></Link>
              <Link href="/plans" className="inline-flex h-13 items-center justify-center rounded-full border border-white/50 px-8 text-sm font-bold transition hover:bg-white/10">View pricing</Link>
            </div>
          </div>
        </section>
      </main>

      <PublicSiteFooter />
    </div>
  );
}
