'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ArcadeEmbed } from '@/components/landing/ArcadeEmbed';
import { PublicSiteHeader } from '@/components/landing/PublicSiteHeader';
import { useRef } from 'react';
import { useRouter } from 'next/navigation';

const TRACKING_WORDS = [
  'Doors',
  'Knocks',
  'Reps',
  'Territories',
  'Conversations',
  'Routes',
  'Campaigns',
  'QR Scans',
  'Follow-ups',
  'Show-up Rate',
  'Lead Sources',
  'Team Activity',
  'Leaderboard',
  'Performance',
  'Time',
  'Distance',
  'Leads',
  'Flyers',
];

export default function LandingPage() {
  const router = useRouter();
  const [trackingWordIndex, setTrackingWordIndex] = useState(0);
  const demoContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const id = setInterval(() => {
      setTrackingWordIndex((i) => (i + 1) % TRACKING_WORDS.length);
    }, 2200);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const error = params.get('error');
    const errorCode = params.get('error_code');
    const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
    const fragment = new URLSearchParams(hash);
    const type = params.get('type') ?? fragment.get('type');
    const hasRecoverySignal = ['code', 'token', 'token_hash', 'access_token', 'refresh_token']
      .some((key) => params.has(key) || fragment.has(key));

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
      if (!callbackURL.searchParams.has('next')) {
        callbackURL.searchParams.set('next', '/home');
      }
      router.replace(`${callbackURL.pathname}${callbackURL.search}`);
      return;
    }

    if (error === 'access_denied' && errorCode) {
      const loginURL = new URL('/login', window.location.origin);
      loginURL.searchParams.set('error', errorCode === 'otp_expired' ? 'reset_link_invalid' : 'auth_failed');
      router.replace(`${loginURL.pathname}${loginURL.search}`);
    }
  }, [router]);

  const handleGetStarted = async () => {
    const demoContainer = demoContainerRef.current;
    if (!demoContainer) return;

    demoContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const fullscreenMethod =
      demoContainer.requestFullscreen ||
      (demoContainer as HTMLDivElement & { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen;

    if (fullscreenMethod) {
      try {
        await fullscreenMethod.call(demoContainer);
      } catch {
        // Ignore rejection (e.g., browser policy); scroll fallback still runs.
      }
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <PublicSiteHeader showAmbassador={false} />

      <main>
        <section className="relative overflow-hidden px-5 py-24 md:px-8 md:py-32">
          <div className="mx-auto flex max-w-7xl flex-col items-center text-center">
            <div className="w-full max-w-4xl">
              <h1 className="text-5xl font-black leading-tight text-zinc-900 md:text-6xl">
                The operating system for field prospecting.
              </h1>
              <p
                className="mt-6 flex items-center justify-center text-2xl font-semibold text-zinc-900"
                aria-live="polite"
              >
                <span className="text-center">Start tracking</span>
                <span className="ml-1 inline-flex w-[12ch] justify-start">
                  <span key={trackingWordIndex} className="inline-block animate-hero-word-in text-red-600">
                    {TRACKING_WORDS[trackingWordIndex]}
                  </span>
                </span>
              </p>
              <div className="mt-10 flex flex-wrap justify-center gap-4">
                <button
                  type="button"
                  onClick={handleGetStarted}
                  className="inline-flex h-12 items-center rounded-2xl bg-zinc-900 px-6 text-base font-semibold text-white transition hover:bg-zinc-700"
                >
                  Get started
                  <ArrowRight className="ml-2 h-4 w-4" />
                </button>
                <Link
                  href="/plans"
                  className="inline-flex h-12 items-center rounded-2xl bg-zinc-100 px-6 text-base font-semibold text-zinc-900 transition hover:bg-zinc-200"
                >
                  View pricing
                </Link>
              </div>
            </div>
          </div>
        </section>

        <section className="pb-0 pt-0">
          <div className="mx-auto w-full max-w-7xl px-5 md:px-8">
            <h2 className="text-center text-3xl font-black leading-tight text-zinc-900 md:text-4xl">
              See FLYR in action
            </h2>
            <p className="mt-3 text-center text-lg text-zinc-500">
              Take a quick product walkthrough directly in the page.
            </p>
            <div
              ref={demoContainerRef}
              className="mx-auto mt-8 w-full max-w-6xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm"
            >
              <ArcadeEmbed />
            </div>
          </div>
        </section>

        <section className="px-5 pb-14 pt-10 md:px-8 md:pb-16">
          <div className="mx-auto flex max-w-7xl flex-col items-center text-center">
            <p className="text-lg font-medium text-zinc-700">Ready to turn prospecting into a system?</p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/login"
                className="inline-flex h-12 items-center rounded-2xl bg-red-600 px-6 text-base font-semibold text-white transition hover:bg-red-500"
              >
                Start with one campaign included
              </Link>
            </div>
          </div>
        </section>
      </main>

    </div>
  );
}
