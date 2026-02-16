'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { getClientAsync } from '@/lib/supabase/client';
import { ArrowRight, Check } from 'lucide-react';
interface PriceOption {
  priceId: string;
  name: string;
  amount: string;
  period: string;
  currency: 'USD' | 'CAD';
  interval: 'month' | 'year';
}

function LandingPricing() {
  const [prices, setPrices] = useState<PriceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [preferredCurrency, setPreferredCurrency] = useState<'USD' | 'CAD'>('USD');

  useEffect(() => {
    fetch('/api/billing/prices')
      .then((res) => res.json())
      .then((data) => setPrices(data.prices || []))
      .catch(() => setPrices([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const getCurrencyFromCountry = (countryCode: string | null | undefined): 'USD' | 'CAD' => {
      if (!countryCode) return 'USD';
      return countryCode.toUpperCase() === 'CA' ? 'CAD' : 'USD';
    };

    const detectPreferredCurrency = async () => {
      // Manual override for testing: ?country=CA or ?country=US
      const params = new URLSearchParams(window.location.search);
      const countryOverride = params.get('country');
      if (countryOverride) {
        setPreferredCurrency(getCurrencyFromCountry(countryOverride));
        return;
      }

      try {
        const res = await fetch('https://ipapi.co/json/', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          setPreferredCurrency(getCurrencyFromCountry(data?.country_code));
          return;
        }
      } catch {
        // Ignore and fall back to locale-based detection.
      }

      const locale = (navigator.language || Intl.DateTimeFormat().resolvedOptions().locale || '').toLowerCase();
      setPreferredCurrency(locale.includes('-ca') ? 'CAD' : 'USD');
    };

    detectPreferredCurrency();
  }, []);

  const symbol = (c: string) => (c === 'USD' ? '$' : 'CA$');
  const usdPlans = prices.filter((p) => p.currency === 'USD');
  const cadPlans = prices.filter((p) => p.currency === 'CAD');
  const preferredPlans = preferredCurrency === 'CAD' ? cadPlans : usdPlans;
  const activePlans = preferredPlans.length > 0 ? preferredPlans : (usdPlans.length > 0 ? usdPlans : cadPlans);
  const parseAmount = (amount: string) => Number.parseFloat(amount.replace(/,/g, ''));
  const yearlyPlans = activePlans.filter((p) => p.interval === 'year');
  const displayProPlan = (yearlyPlans.length > 0 ? yearlyPlans : activePlans).reduce<PriceOption | null>((best, plan) => {
    if (!best) return plan;
    return parseAmount(plan.amount) < parseAmount(best.amount) ? plan : best;
  }, null);
  const loginRedirect = `/login?redirect=${encodeURIComponent('/pricing')}`;

  if (loading) {
    return <div className="mt-8 text-center text-sm text-zinc-600">Loading plans...</div>;
  }

  return (
    <div className="mt-8 grid gap-6 md:grid-cols-2">
      <article className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm">
        <h3 className="text-xl font-semibold text-zinc-900">Starter</h3>
        <p className="mt-2 text-sm text-zinc-600">iOS plan for businesses testing software.</p>
        <p className="mt-5 text-4xl font-bold text-zinc-900">$0</p>
        <p className="text-sm text-zinc-500">per month</p>
        <ul className="mt-6 space-y-2 text-sm text-zinc-700">
          {[
            'iOS only',
            'Campaign planning',
            'Territory map view',
            'Optimized route (basic) street-by-street order',
            'Door tracking (No answer / Talked / Follow-up)',
            'Performance tracking (basic): doors knocked + scans',
            'Leaderboard (weekly)',
            'Up to 50 contacts / leads',
            '1 active campaign at a time',
            'Email support',
          ].map((item) => (
            <li key={item} className="flex items-center gap-2">
              <Check className="h-4 w-4 text-red-600" />
              {item}
            </li>
          ))}
        </ul>
      </article>

      <article className="rounded-3xl border-2 border-red-600 bg-red-50 p-6 shadow-sm">
        <h3 className="text-xl font-semibold text-zinc-900">Pro</h3>
        <p className="mt-2 text-sm text-zinc-600">iOS + Desktop dashboard for teams running serious flyer volume.</p>
        {displayProPlan && (
          <div className="mt-5">
            <p className="text-4xl font-bold text-zinc-900">
              {symbol(displayProPlan.currency)}{displayProPlan.amount}
            </p>
            <p className="text-sm text-zinc-500">{displayProPlan.period}</p>
            {displayProPlan.interval === 'year' && (
              <p className="mt-1 text-xs font-medium text-zinc-500">billed yearly</p>
            )}
          </div>
        )}
        <ul className="mt-6 space-y-2 text-sm text-zinc-700">
          {[
            'iOS + Desktop dashboard',
            'Unlimited campaigns',
            'Unlimited contacts / leads',
            'Tags + custom statuses',
            'Advanced optimized routing (smart street order + walkable flow)',
            'Address-level QR tracking (exact house that scanned)',
            'Unlimited QR codes (bulk generator)',
            'Advanced performance analytics',
            'Doors knocked, convos, follow-ups, scans',
            'Follow-up system (tasks, reminders, call list)',
            'Exports (CSV / CRM-ready)',
            'Team mode (assign areas, shared progress)',
            'Team leaderboards + activity feed',
            'CRM integrations (Follow Up Boss / webhook / Zapier-style)',
            'Priority support',
          ].map((item) => (
            <li key={item} className="flex items-center gap-2">
              <Check className="h-4 w-4 text-red-600" />
              {item}
            </li>
          ))}
        </ul>

        <div className="mt-6 space-y-2">
          {prices.length === 0 && (
            <Link
              href={loginRedirect}
              className="inline-flex h-11 w-full items-center justify-center rounded-2xl bg-zinc-900 text-sm font-semibold text-white transition hover:bg-zinc-700"
            >
              See Pro pricing
            </Link>
          )}

          {preferredPlans.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {preferredCurrency}
              </p>
              {preferredPlans.map((plan) => (
                <Link
                  key={plan.priceId}
                  href={loginRedirect}
                  className="inline-flex h-11 w-full items-center justify-center rounded-2xl bg-zinc-900 px-4 text-sm font-semibold text-white transition hover:bg-zinc-700"
                >
                  {symbol(plan.currency)}{plan.amount}{plan.period}
                  {plan.interval === 'year' ? ' billed yearly' : ''}
                </Link>
              ))}
            </div>
          )}

          {preferredPlans.length === 0 && usdPlans.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">USD</p>
              {usdPlans.map((plan) => (
                <Link
                  key={plan.priceId}
                  href={loginRedirect}
                  className="inline-flex h-11 w-full items-center justify-center rounded-2xl bg-zinc-900 px-4 text-sm font-semibold text-white transition hover:bg-zinc-700"
                >
                  {symbol(plan.currency)}{plan.amount}{plan.period}
                  {plan.interval === 'year' ? ' billed yearly' : ''}
                </Link>
              ))}
            </div>
          )}

          {preferredPlans.length === 0 && cadPlans.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">CAD</p>
              {cadPlans.map((plan) => (
                <Link
                  key={plan.priceId}
                  href={loginRedirect}
                  className="inline-flex h-11 w-full items-center justify-center rounded-2xl bg-zinc-900 px-4 text-sm font-semibold text-white transition hover:bg-zinc-700"
                >
                  {symbol(plan.currency)}{plan.amount}{plan.period}
                  {plan.interval === 'year' ? ' billed yearly' : ''}
                </Link>
              ))}
            </div>
          )}

          <Link
            href="/login"
            className="inline-flex h-11 w-full items-center justify-center rounded-2xl border border-zinc-900 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-900 hover:text-white"
          >
            Get started
          </Link>
        </div>
      </article>
    </div>
  );
}

const TRACKING_WORDS = [
  'Doors',
  'Conversations',
  'Routes',
  'QR Scans',
  'Time',
  'Distance',
  'Leads',
  'Appointments',
  'Conversion rates',
  'Flyers',
];

const heroShots = [
  { src: '/landing/cover-3d-route.png', alt: '3D route map view' },
  { src: '/landing/cover-neighborhood.png', alt: 'Neighborhood route map' },
  { src: '/landing/cover-mobile-session.png', alt: 'Mobile session start' },
];

const desktopShots = [
  { src: '/landing/WEIRFF_1.png', alt: 'Desktop command center 1', title: '' },
  { src: '/landing/WEIRFF_2.png', alt: 'Desktop command center 2', title: 'Unique QR codes for smart tracking' },
  { src: '/landing/WEIRFF_3.png', alt: 'Desktop command center 3', title: '' },
  { src: '/landing/WEIRFF_4.png', alt: 'Desktop command center 4', title: '' },
  { src: '/landing/WEIRFF_5.png', alt: 'Desktop command center 5', title: '' },
  { src: '/landing/WEIRFF_6.png', alt: 'Desktop command center 6', title: '' },
];

const mobileShots = [
  { src: '/landing/green-houses-dashboard.png', alt: 'Campaign progress with visited buildings' },
  { src: '/landing/IMG_1708.png', alt: 'Mobile leaderboard' },
  { src: '/landing/mobile-column-markers.png', alt: 'Mobile address form and map' },
  { src: '/landing/mobile-leaderboard.png', alt: 'Share activity' },
  { src: '/landing/mobile-session-red.png', alt: 'Mobile start session' },
  { src: '/landing/mobile-lead-detail.png', alt: 'Lead detail view' },
];

function ScreenshotCard({
  src,
  alt,
  className = '',
  objectFit = 'contain',
}: {
  src: string;
  alt: string;
  className?: string;
  objectFit?: 'contain' | 'cover';
}) {
  const [missing, setMissing] = useState(false);

  return (
    <div className={`relative overflow-hidden rounded-3xl border border-zinc-700 bg-zinc-900 ${className}`}>
      {missing ? (
        <div className="flex h-full min-h-[180px] items-center justify-center bg-zinc-800 p-4 text-center text-xs text-zinc-300">
          Add image file: {src}
        </div>
      ) : (
        <Image
          src={src}
          alt={alt}
          fill
          className={objectFit === 'cover' ? 'object-cover' : 'object-contain'}
          sizes="(max-width: 768px) 100vw, 50vw"
          onError={() => setMissing(true)}
        />
      )}
    </div>
  );
}

export default function LandingPage() {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [trackingWordIndex, setTrackingWordIndex] = useState(0);
  const [desktopShotIndex, setDesktopShotIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setTrackingWordIndex((i) => (i + 1) % TRACKING_WORDS.length);
    }, 2200);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getClientAsync()
      .then((supabase) => supabase.auth.getSession())
      .then(({ data: { session } }) => {
        if (cancelled) return;
        if (session?.user) {
          router.replace('/home');
          return;
        }
        setChecking(false);
      })
      .catch(() => setChecking(false));

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-100">
        <p className="text-zinc-600">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-red-500 text-zinc-900">
      <header className="sticky top-0 z-50 bg-transparent">
        <div className="flex w-full items-center justify-between px-2 py-2 md:px-4">
          <Link href="/" className="flex items-end">
            <span className="text-6xl font-black leading-none tracking-tight text-black md:text-7xl">FLYR</span>
          </Link>

          <div className="hidden items-center gap-3 md:flex">
            <a
              href="#pricing"
              className="inline-flex h-12 items-center rounded-2xl bg-white px-6 text-base font-semibold text-zinc-900 transition hover:bg-zinc-100"
            >
              Pricing
            </a>
            <Link
              href="/login"
              className="inline-flex h-12 items-center rounded-2xl bg-zinc-900 px-6 text-base font-semibold text-white transition hover:bg-zinc-700"
            >
              Sign in
            </Link>
          </div>
        </div>

        <div className="px-5 pb-3 md:hidden">
          <a
            href="#pricing"
            className="block rounded-2xl border border-zinc-300 bg-white px-4 py-3 text-center text-sm font-semibold text-zinc-800"
          >
            Pricing
          </a>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden border-b border-zinc-200 bg-red-500 px-5 py-16 md:px-8 md:py-24">
          <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div>
              <h1 className="max-w-xl text-3xl font-black leading-tight text-white md:text-4xl">
                Stop Guessing
              </h1>
              <p className="mt-5 flex max-w-xl flex-wrap items-baseline gap-x-2 text-3xl font-black leading-tight text-zinc-950 md:text-4xl">
                <span>Start Tracking</span>
                <span
                  key={trackingWordIndex}
                  className="min-w-[4ch] animate-hero-word-in text-white"
                  aria-hidden
                >
                  {TRACKING_WORDS[trackingWordIndex]}
                </span>
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <Link
                  href="/login"
                  className="inline-flex h-12 items-center rounded-2xl bg-zinc-900 px-6 text-base font-semibold text-white transition hover:bg-zinc-700"
                >
                  Get started
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
                <a
                  href="#pricing"
                  className="inline-flex h-12 items-center rounded-2xl border border-zinc-900 bg-white px-6 text-base font-semibold text-zinc-900 transition hover:bg-zinc-100"
                >
                  View pricing
                </a>
              </div>
            </div>

            <div className="space-y-4">
              <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-white/20 shadow-2xl">
                <ScreenshotCard
                  src="/landing/WEIRFF_2.png"
                  alt="Unique QR codes for smart tracking"
                  className="h-full min-h-[280px]"
                  objectFit="contain"
                />
              </div>
              <p className="text-center text-xl font-semibold text-white md:text-2xl">
                Unique QR codes for smart tracking
              </p>
            </div>
          </div>
        </section>

        <section className="border-t border-zinc-200 bg-white px-5 py-16 md:px-8">
          <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1fr_1fr] lg:items-center">
            <div>
              <h2 className="text-3xl font-black leading-tight text-zinc-900 md:text-4xl">
                We help businesses track what actually works when marketing to homeowners.
              </h2>
              <p className="mt-5 text-lg text-zinc-600">
                Everything from which home scanned your QR code, to how many conversations you had, to how many turned into appointments — so you know what's working and can repeat it.
              </p>
              <Link
                href="/login"
                className="mt-8 inline-flex h-12 items-center rounded-2xl bg-zinc-900 px-6 text-base font-semibold text-white transition hover:bg-zinc-700"
              >
                Sign up
              </Link>
            </div>
            <div className="relative overflow-hidden rounded-3xl border border-zinc-200 shadow-lg">
              <Image
                src="/landing/hero-dashboard-map.png"
                alt="Campaign dashboard with map, addresses, and scan metrics"
                width={800}
                height={500}
                className="h-auto w-full object-cover"
              />
            </div>
          </div>
        </section>

        <section className="px-5 py-16 md:px-8">
          <div className="mx-auto max-w-7xl">
            <article className="rounded-3xl border border-zinc-700 bg-zinc-950 p-6 text-white">
              <h2 className="text-3xl font-black leading-tight md:text-4xl">Desktop command center.</h2>
              <p className="mt-4 text-lg text-zinc-300">
                Real campaign view, draw mode, and live scanned-home overlays.
              </p>
              <div className="mt-8 flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => setDesktopShotIndex((i) => (i - 1 + desktopShots.length) % desktopShots.length)}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-zinc-500 bg-zinc-800 text-white transition hover:bg-zinc-700"
                  aria-label="Previous"
                >
                  <ArrowRight className="h-5 w-5 rotate-180" />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900">
                    <ScreenshotCard
                      key={desktopShots[desktopShotIndex].src}
                      src={desktopShots[desktopShotIndex].src}
                      alt={desktopShots[desktopShotIndex].alt}
                      className="h-full min-h-[280px]"
                    />
                  </div>
                  {desktopShots[desktopShotIndex].title ? (
                    <p className="mt-4 text-center text-lg font-medium text-white">
                      {desktopShots[desktopShotIndex].title}
                    </p>
                  ) : (
                    <p className="mt-4 text-center text-sm text-zinc-500">
                      Add a title in desktopShots for this slide when ready.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setDesktopShotIndex((i) => (i + 1) % desktopShots.length)}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-zinc-500 bg-zinc-800 text-white transition hover:bg-zinc-700"
                  aria-label="Next"
                >
                  <ArrowRight className="h-5 w-5" />
                </button>
              </div>
            </article>
          </div>
        </section>

        <section className="px-5 pb-16 md:px-8">
          <div className="mx-auto max-w-7xl rounded-3xl border border-zinc-700 bg-zinc-950 p-6 text-white">
            <h3 className="text-3xl font-black">Mobile field mode.</h3>
            <p className="mt-3 text-lg text-zinc-300">
              Session controls, progress colors, and leaderboard views from iOS.
            </p>
<div className="mt-8 grid grid-cols-6 gap-3">
              {mobileShots.map((shot) => (
                <ScreenshotCard
                  key={shot.src}
                  src={shot.src}
                  alt={shot.alt}
                  className="aspect-[9/19] w-full min-w-0"
                  objectFit="contain"
                />
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="border-y border-zinc-200 bg-white px-5 py-16 md:px-8">
          <div className="mx-auto max-w-5xl">
            <div className="text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-red-600">Pricing</p>
              <h2 className="mt-3 text-4xl font-black">Pick your plan</h2>
              <p className="mt-3 text-lg text-zinc-600">Simple pricing in one place. Start free, upgrade when you are ready.</p>
            </div>
            <LandingPricing />
          </div>
        </section>
      </main>

      <footer className="px-5 py-10 md:px-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 text-sm text-zinc-600 md:flex-row">
          <span>© {new Date().getFullYear()} FLYR Pro</span>
          <div className="flex items-center gap-6">
            <Link href="/login" className="hover:text-zinc-900">Sign in</Link>
            <Link href="/#pricing" className="hover:text-zinc-900">Pricing</Link>
            <Link href="/privacy" className="hover:text-zinc-900">Privacy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
