'use client';

import { useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BarChart3,
  ClipboardCheck,
  MapPinned,
  QrCode,
  Sparkles,
  Target,
  Users,
} from 'lucide-react';
import { LandingVideo } from '@/components/landing/LandingVideo';
import { PhoneVideoFrame } from '@/components/landing/PhoneVideoFrame';
import { PublicSiteFooter } from '@/components/landing/PublicSiteFooter';
import { PublicSiteHeader } from '@/components/landing/PublicSiteHeader';

const workflow = [
  {
    number: '01',
    title: 'Draw territory',
    copy: 'Outline an area and turn its streets, buildings, and addresses into a campaign in seconds.',
    icon: MapPinned,
  },
  {
    number: '02',
    title: 'Assign to team',
    copy: 'Give reps clear ownership of campaigns and territories so everyone knows exactly where to work.',
    icon: Users,
  },
  {
    number: '03',
    title: 'Watch live',
    copy: 'See your team move through the field and watch door results, conversations, and leads appear live.',
    icon: Target,
  },
  {
    number: '04',
    title: 'Track all data',
    copy: 'Track doors, conversations, leads, follow-ups, QR scans, and performance in one shared system.',
    icon: BarChart3,
  },
];

const industries = [
  'Real estate',
  'Roofing',
  'Solar',
  'Plumbing',
  'Painting',
  'HVAC',
  'Landscaping',
  'Pest control',
  'Home services',
  'Insurance',
  'Finance',
  'Charities',
  'Political campaigns',
  'Telecommunications',
  'Home security',
  'Energy',
  'Fundraising',
  'Door-to-door teams',
];

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
      <PublicSiteHeader showAmbassador={false} />

      <main>
        <section className="relative overflow-hidden px-5 pb-16 pt-16 md:px-8 md:pb-24 md:pt-24">
          <div className="pointer-events-none absolute left-1/2 top-0 h-[540px] w-[900px] -translate-x-1/2 rounded-full bg-red-500/10 blur-[120px]" />
          <div className="relative mx-auto max-w-7xl">
            <div className="mx-auto max-w-5xl text-center">
              <p className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-red-700">
                <Sparkles className="h-3.5 w-3.5" />
                Field prospecting, finally connected
              </p>
              <h1 className="mt-7 text-balance text-5xl font-black leading-[0.95] tracking-[-0.055em] sm:text-6xl md:text-8xl">
                Own every street.
                <span className="block text-red-600">Follow every lead.</span>
              </h1>
              <p className="mx-auto mt-7 max-w-3xl text-pretty text-lg leading-8 text-zinc-600 md:text-xl">
                Plan territories, guide reps, record every conversation, and turn field activity into a system your whole team can see.
              </p>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link
                  href="/login"
                  className="inline-flex h-13 w-full items-center justify-center rounded-full bg-zinc-950 px-7 text-sm font-bold text-white transition hover:bg-red-600 sm:w-auto"
                >
                  Start with one campaign
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
                <Link
                  href="/#workflow"
                  className="inline-flex h-13 w-full items-center justify-center rounded-full border border-zinc-300 bg-white/70 px-7 text-sm font-bold text-zinc-900 transition hover:border-zinc-950 sm:w-auto"
                >
                  See how it works
                </Link>
              </div>
              <p className="mt-4 text-xs font-medium text-zinc-500">No credit card required · iOS + Android + desktop</p>
            </div>

            <div className="relative mx-auto mt-14 max-w-6xl md:mt-20">
              <h2 className="mb-8 text-center text-3xl font-black tracking-[-0.035em] text-zinc-950 sm:text-4xl md:mb-10 md:text-5xl">
                Worlds First 3D Prospecting Map
              </h2>
              <LandingVideo
                videoId="f33655d88ab11a69ed2f111a1652a895"
                label="WolfGrid campaign creation demonstration"
                className="aspect-video border border-zinc-800"
                videoClassName="object-cover"
              />
            </div>
          </div>
        </section>

        <section className="border-y border-zinc-200 bg-white px-5 py-7 md:px-8">
          <div className="mx-auto grid max-w-7xl items-center gap-5 lg:grid-cols-[auto_minmax(0,1fr)] lg:gap-12">
            <p className="shrink-0 text-center text-xs font-bold uppercase tracking-[0.18em] text-zinc-400 lg:text-left">
              Built for teams that win in the field
            </p>
            <div className="industry-marquee-viewport min-w-0 overflow-hidden" aria-label="Industries using WolfGrid">
              <div className="industry-marquee flex w-max items-center">
                {[false, true].map((duplicate) => (
                  <div
                    key={duplicate ? 'duplicate' : 'primary'}
                    className={`flex shrink-0 items-center gap-8 pr-8 ${duplicate ? 'industry-marquee-duplicate' : ''}`}
                    aria-hidden={duplicate || undefined}
                  >
                    {industries.map((industry) => (
                      <span key={industry} className="flex shrink-0 items-center gap-8 text-sm font-bold text-zinc-700">
                        {industry}
                        <span className="h-1 w-1 rounded-full bg-red-500" aria-hidden="true" />
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="product" className="scroll-mt-24 px-5 py-20 md:px-8 md:py-32">
          <div className="mx-auto max-w-7xl">
            <div className="grid items-end gap-8 lg:grid-cols-[1.15fr_0.85fr]">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-red-600">One source of truth</p>
                <h2 className="mt-4 max-w-4xl text-4xl font-black leading-[1.02] tracking-[-0.04em] md:text-6xl">
                  Your team is outside. Your system should be too.
                </h2>
              </div>
              <p className="max-w-xl text-lg leading-8 text-zinc-600 lg:pb-1">
                Stop piecing together maps, notes, spreadsheets, texts, and follow-up lists. WolfGrid keeps the work connected from the first street to the next conversation.
              </p>
            </div>

            <div className="mt-14 grid gap-5 lg:grid-cols-12">
              <article className="rounded-[2rem] bg-zinc-950 p-6 text-white md:p-8 lg:col-span-7">
                <div className="flex h-full flex-col">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-red-600">
                    <MapPinned className="h-5 w-5" />
                  </span>
                  <h3 className="mt-8 text-3xl font-black tracking-tight">See the territory before you step into it.</h3>
                  <p className="mt-3 max-w-xl leading-7 text-zinc-400">
                    Turn real buildings and addresses into a campaign, then understand the opportunity at a glance.
                  </p>
                  <PhoneVideoFrame
                    videoId="e3a3a6c8b6950f328f505fc1968e744a"
                    label="WolfGrid desktop territory demonstration"
                    orientation="landscape"
                    className="mt-8 w-full"
                  />
                </div>
              </article>

              <article className="flex flex-col rounded-[2rem] border border-zinc-200 bg-white p-6 md:p-8 lg:col-span-5">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-red-50 text-red-600">
                  <Target className="h-5 w-5" />
                </span>
                <h3 className="mt-8 text-3xl font-black tracking-tight">Keep the next move obvious.</h3>
                <p className="mt-3 leading-7 text-zinc-600">
                  Reps know where to go, what happened, and which doors need another conversation.
                </p>
                <PhoneVideoFrame
                  videoId="092563d94330b121261327e9d9f84e6e"
                  label="WolfGrid mobile canvassing route demonstration"
                  orientation="portrait"
                  className="mx-auto mt-8 w-full max-w-[320px]"
                />
              </article>
            </div>
          </div>
        </section>

        <section id="workflow" className="scroll-mt-24 bg-[#111] px-5 py-20 text-white md:px-8 md:py-32">
          <div className="mx-auto max-w-7xl">
            <div className="max-w-3xl">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-red-500">How WolfGrid works</p>
              <h2 className="mt-4 text-4xl font-black leading-[1.02] tracking-[-0.04em] md:text-6xl">
                From an empty map to a finished campaign.
              </h2>
            </div>

            <div className="mt-14 grid gap-px overflow-hidden rounded-[2rem] border border-white/10 bg-white/10 md:grid-cols-2 lg:grid-cols-4">
              {workflow.map(({ number, title, copy, icon: Icon }) => (
                <article key={number} className="bg-[#111] p-7 md:min-h-80 md:p-8">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold tracking-[0.2em] text-zinc-600">{number}</span>
                    <Icon className="h-5 w-5 text-red-500" />
                  </div>
                  <h3 className="mt-16 text-2xl font-black">{title}</h3>
                  <p className="mt-4 text-sm leading-7 text-zinc-400">{copy}</p>
                </article>
              ))}
            </div>

            <LandingVideo
              videoId="35626091679be33b2feb207585a04ea6"
              label="WolfGrid team campaign assignment demonstration"
              className="mt-8 aspect-video border border-white/10"
              videoClassName="object-cover"
            />
          </div>
        </section>

        <section className="px-5 py-20 md:px-8 md:py-32">
          <div className="mx-auto max-w-7xl">
            <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-red-600">Built for accountability</p>
                <h2 className="mt-4 text-4xl font-black leading-[1.02] tracking-[-0.04em] md:text-6xl">
                  Know what is happening without chasing updates.
                </h2>
                <p className="mt-6 max-w-xl text-lg leading-8 text-zinc-600">
                  Shared progress, activity feeds, leaderboards, and campaign analytics make the work visible without turning the day into reporting admin.
                </p>
                <div className="mt-8 grid gap-3 sm:grid-cols-2">
                  {[
                    [Users, 'Team activity'],
                    [BarChart3, 'Campaign analytics'],
                    [QrCode, 'Address-level QR tracking'],
                    [ClipboardCheck, 'Organized follow-up'],
                  ].map(([Icon, label]) => {
                    const FeatureIcon = Icon as typeof Users;
                    return (
                      <div key={label as string} className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-4">
                        <FeatureIcon className="h-4 w-4 text-red-600" />
                        <span className="text-sm font-bold">{label as string}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-[0.72fr_1fr] items-end gap-4">
                <div className="relative aspect-[4/5] overflow-hidden rounded-[1.75rem] bg-zinc-950 shadow-sm">
                  <Image
                    src="/field-agent-wolfgrid.jpg"
                    alt="Field sales agent using WolfGrid outdoors"
                    fill
                    sizes="(min-width: 1024px) 21vw, 42vw"
                    className="object-cover object-center"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/15 via-transparent to-transparent" aria-hidden="true" />
                </div>
                <LandingVideo
                  videoId="ed341acd14ebf01cb7b4bf6491302134"
                  label="WolfGrid team activity dashboard demonstration"
                  className="aspect-[4/5] translate-y-8"
                  videoClassName="object-cover"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="px-5 pb-20 md:px-8 md:pb-32">
          <div className="mx-auto grid max-w-7xl overflow-hidden rounded-[2.5rem] bg-red-600 text-white lg:grid-cols-[0.9fr_1.1fr]">
            <div className="p-8 md:p-12 lg:p-16">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-red-100">Customer proof</p>
              <blockquote className="mt-7 text-3xl font-black leading-tight tracking-tight md:text-4xl">
                “I’ve never seen field sales software that can detect when you’ve knocked a door without taking out your phone. WolfGrid understands how agents actually knock doors.”
              </blockquote>
              <div className="mt-8 border-t border-white/20 pt-6">
                <p className="font-bold">Walid Dorani</p>
                <p className="mt-1 text-sm text-red-100">Broker · REVEL Realty Inc.</p>
              </div>
            </div>
            <div className="relative min-h-96 overflow-hidden bg-zinc-950 lg:min-h-full">
              <Image
                src="/walid-dorani-testimonial.png"
                alt="Portrait of Walid Dorani"
                fill
                sizes="(min-width: 1024px) 55vw, 100vw"
                className="object-cover object-[center_34%]"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent" aria-hidden="true" />
            </div>
          </div>
        </section>

        <section className="bg-zinc-950 px-5 py-20 text-white md:px-8 md:py-28">
          <div className="mx-auto flex max-w-5xl flex-col items-center text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-red-500">One campaign included</p>
            <h2 className="mt-5 text-4xl font-black leading-[1.02] tracking-[-0.04em] md:text-6xl">
              Put your next territory on the grid.
            </h2>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-zinc-400">
              Start on desktop, take the route with you on iOS or Android, and keep every result connected.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link href="/login" className="inline-flex h-13 items-center justify-center rounded-full bg-red-600 px-7 text-sm font-bold text-white transition hover:bg-red-500">
                Start free <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
              <Link href="/plans" className="inline-flex h-13 items-center justify-center rounded-full border border-white/20 px-7 text-sm font-bold text-white transition hover:bg-white/10">
                View pricing
              </Link>
            </div>
          </div>
        </section>
      </main>

      <PublicSiteFooter />
    </div>
  );
}
