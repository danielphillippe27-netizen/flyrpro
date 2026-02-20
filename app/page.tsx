'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { getClientAsync } from '@/lib/supabase/client';
import { ArrowRight } from 'lucide-react';
import { PricingCard } from '@/components/pricing/PricingCard';
import { TeamSeatSelector } from '@/components/pricing/TeamSeatSelector';

function LandingPricing() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/billing/prices')
      .then(() => {})
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const loginRedirect = `/login?redirect=${encodeURIComponent('/pricing')}`;

  const proFeatures = [
    { text: 'Desktop dashboard' },
    { text: 'iOS field app' },
    { text: 'Smart maps' },
    { text: 'Territory drawing' },
    { text: 'Unlimited campaigns + contacts' },
    { text: 'Lead list' },
    { text: 'Smart route optimization (walkable flow)' },
    { text: 'Address-level QR tracking + bulk generator' },
    { text: 'Performance analytics (doors, scans, follow-ups)' },
    { text: 'Conversion metrics' },
    { text: 'Follow-up system (tasks, reminders, call list)' },
    { text: 'Personal goals' },
    { text: 'Exports (CSV / CRM-ready)' },
    { text: 'CRM integrations (Follow Up Boss / webhook)' },
    { text: 'Priority support' },
  ];

  const teamFeatures = [
    { text: 'Everything in Pro', bold: true },
    { text: '2 seats included in base price' },
    { text: 'Invite / remove team members' },
    { text: 'Roles & permissions (Admin, Member)' },
    { text: 'Assign territories & campaigns to teammates' },
    { text: 'Shared progress + activity feed' },
    { text: 'Team leaderboards' },
    { text: 'Team analytics (by member, by campaign)' },
    { text: 'Centralized billing' },
    { text: 'Priority support' },
  ];

  if (loading) {
    return <div className="mt-8 text-center text-sm text-zinc-600">Loading plans...</div>;
  }

  return (
    <div className="mt-8 grid gap-6 md:grid-cols-2">
      <PricingCard
        title="Pro"
        subtitle="For serious flyer volume."
        features={proFeatures}
        cta={
          <>
            <p className="text-center text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              CA$39.99 / month
            </p>
            <Link
              href={loginRedirect}
              className="inline-flex h-11 w-full items-center justify-center rounded-2xl bg-zinc-900 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Get started
            </Link>
          </>
        }
      />
      <PricingCard
        title="Team"
        subtitle="Collaboration + accountability for small teams."
        features={teamFeatures}
        cta={
          <>
            <TeamSeatSelector />
            <p className="text-center text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              CA$79.99 / month + CA$30 per seat
            </p>
            <Link
              href={loginRedirect}
              className="inline-flex h-11 w-full items-center justify-center rounded-2xl bg-zinc-900 text-sm font-semibold text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Start team
            </Link>
          </>
        }
      />
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
  { src: '/landing/WEIRFF_1.png', alt: 'Desktop dashboard 1', title: '' },
  { src: '/landing/WEIRFF_2.png', alt: 'Desktop dashboard 2', title: '' },
  { src: '/landing/WEIRFF_3.png', alt: 'Desktop dashboard 3', title: '' },
  { src: '/landing/WEIRFF_4.png', alt: 'Desktop dashboard 4', title: '' },
  { src: '/landing/WEIRFF_5.png', alt: 'Desktop dashboard 5', title: '' },
  { src: '/landing/WEIRFF_6.png', alt: 'Desktop dashboard 6', title: '' },
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
          router.replace('/gate');
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
          <div className="mx-auto flex max-w-7xl flex-col items-center text-center">
            <div className="w-full max-w-4xl">
              <h1 className="text-5xl font-black leading-tight text-white md:text-6xl">
                Stop Guessing
              </h1>
              <p className="mt-5 flex flex-wrap items-baseline justify-center gap-x-2 text-5xl font-black leading-tight text-zinc-950 md:text-6xl">
                <span>Start Tracking</span>
                <span
                  key={trackingWordIndex}
                  className="min-w-[4ch] animate-hero-word-in text-white"
                  aria-hidden
                >
                  {TRACKING_WORDS[trackingWordIndex]}
                </span>
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-4">
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
              <h2 className="text-center text-3xl font-black leading-tight md:text-4xl">Desktop dashboard.</h2>
              <p className="mt-4 text-center text-lg text-zinc-300">
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
                  ) : null}
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
            <h3 className="text-center text-3xl font-black">Mobile field mode.</h3>
            <p className="mt-3 text-center text-lg text-zinc-300">
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
              <p className="mt-3 text-lg text-zinc-600">Simple pricing. Scale when you&apos;re ready.</p>
            </div>
            <LandingPricing />
          </div>
        </section>
      </main>

    </div>
  );
}
