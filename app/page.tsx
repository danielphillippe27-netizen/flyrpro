'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ArcadeEmbed } from '@/components/landing/ArcadeEmbed';

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
  const [trackingWordIndex, setTrackingWordIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setTrackingWordIndex((i) => (i + 1) % TRACKING_WORDS.length);
    }, 2200);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="sticky top-0 z-50 border-b border-zinc-200/80 bg-zinc-50/90 backdrop-blur-sm">
        <div className="flex w-full items-center justify-between px-4 py-3 md:px-6">
          <Link href="/" className="flex items-end">
            <span className="text-4xl font-black leading-none tracking-tight text-red-600 md:text-5xl">FLYR</span>
          </Link>

          <div className="flex items-center gap-5 md:gap-6">
            <Link
              href="/plans"
              className="text-sm font-medium text-zinc-600 transition hover:text-zinc-900"
            >
              Pricing
            </Link>
            <Link
              href="/download"
              className="text-sm font-medium text-zinc-600 transition hover:text-zinc-900"
            >
              Download
            </Link>
            <Link
              href="/login"
              className="inline-flex h-9 items-center rounded-lg border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-100"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

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
                <Link
                  href="/login"
                  className="inline-flex h-12 items-center rounded-2xl bg-zinc-900 px-6 text-base font-semibold text-white transition hover:bg-zinc-700"
                >
                  Get started
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
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
            <div className="mx-auto mt-8 w-full max-w-6xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
              <ArcadeEmbed />
            </div>
          </div>
        </section>

        <section className="px-5 pb-14 pt-10 md:px-8 md:pb-16">
          <div className="mx-auto flex max-w-7xl flex-col items-center text-center">
            <p className="text-lg font-medium text-zinc-700">Ready to turn prospecting into a system?</p>
            <Link
              href="/login"
              className="mt-4 inline-flex h-12 items-center rounded-2xl bg-red-600 px-6 text-base font-semibold text-white transition hover:bg-red-500"
            >
              Start your free trial
            </Link>
          </div>
        </section>
      </main>

    </div>
  );
}
