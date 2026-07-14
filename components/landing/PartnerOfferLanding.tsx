'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { ExclusiveOfferArcadeEmbed } from '@/components/landing/ExclusiveOfferArcadeEmbed';
import { useEffect, useState } from 'react';
import { isJustListedDmOffer, isThirtyDayChallengePartnerOffer } from '@/components/offers/partnerOfferUtils';

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

type PartnerOfferLandingProps = {
  offerTitle: string;
  offerMessage: string | null;
  partnerName: string;
  recipientName: string | null;
  expiresAt: string;
  ctaLabel: string | null;
  offerToken: string;
  /** Team Partner template uses forced team onboarding; DM / included-campaign offers use standard flow. */
  partnerOnboardingTeamStyle: boolean;
};

function partnerOnboardingHref(
  offerToken: string,
  partnerOnboardingTeamStyle: boolean,
  offerTitle: string,
  offerMessage: string | null
) {
  const qs = new URLSearchParams({
    offer: 'exclusive30',
    partnerOfferToken: offerToken,
    partnerExclusive: partnerOnboardingTeamStyle ? 'team' : 'solo',
  });
  if (isThirtyDayChallengePartnerOffer(offerTitle, offerMessage)) {
    qs.set('challenge30', '1');
  }
  return `/onboarding?${qs.toString()}`;
}

function formatLongDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function toParagraphs(value: string | null): string[] {
  return (value ?? '')
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

const JUST_LISTED_DM_DEFAULTS = {
  title: 'Use this listing to win the neighbourhood.',
  primaryMessage: "You've already got the listing.",
  secondaryMessage:
    'Now use WolfGrid to turn it into more exposure, more conversations, and your next client.',
  tertiaryMessage:
    'Use flyers and doorknocking around your listing to create local buzz, uncover buyers, and meet nearby sellers before this window closes.',
  primaryCta: 'See the listing play',
  secondaryCta: 'See the listing strategy',
} as const;

function JustListedDmOfferLanding({
  offerTitle,
  offerMessage,
  partnerName,
  recipientName,
  expiresAt,
  ctaLabel,
  demoInstance,
  isDemoOpen,
  onGetStarted,
  onShowDemo,
  onDemoOpenChange,
}: Omit<PartnerOfferLandingProps, 'offerToken'> & {
  demoInstance: number;
  isDemoOpen: boolean;
  onGetStarted: () => void;
  onShowDemo: () => void;
  onDemoOpenChange: (open: boolean) => void;
}) {
  const paragraphs = toParagraphs(offerMessage);
  const shouldUseDefaultTitle = !offerTitle.trim() || /private access/i.test(offerTitle);
  const usesLegacyMessage =
    paragraphs.length === 0 ||
    /invite-only|claim access|private link|private access/i.test(offerMessage ?? '');
  const primaryMessage = usesLegacyMessage
    ? JUST_LISTED_DM_DEFAULTS.primaryMessage
    : (paragraphs[0] ?? JUST_LISTED_DM_DEFAULTS.primaryMessage);
  const secondaryMessage = usesLegacyMessage
    ? JUST_LISTED_DM_DEFAULTS.secondaryMessage
    : (paragraphs[1] ?? JUST_LISTED_DM_DEFAULTS.secondaryMessage);
  const primaryCta =
    !ctaLabel?.trim() || /claim private access/i.test(ctaLabel)
      ? JUST_LISTED_DM_DEFAULTS.primaryCta
      : ctaLabel.trim();
  const displayTitle = shouldUseDefaultTitle ? JUST_LISTED_DM_DEFAULTS.title : offerTitle;

  return (
    <div className="min-h-screen bg-[#09090b] text-white">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-black/55 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-end">
            <span className="text-3xl font-black leading-none tracking-tight text-red-500 sm:text-4xl">WolfGrid</span>
          </Link>
          <div className="inline-flex items-center rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-red-200">
            Door-to-door software
          </div>
        </div>
      </header>

      <main className="pb-10">
        <section className="px-4 pb-6 pt-5 sm:px-6 sm:pb-8 sm:pt-8">
          <div className="mx-auto max-w-5xl">
            <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(239,68,68,0.18),_rgba(24,24,27,0.96)_42%)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)] sm:p-6">
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs font-medium text-zinc-400 sm:text-sm">
                <span>{partnerName}</span>
                {recipientName ? <span>For {recipientName}</span> : null}
                <span>Expires {formatLongDate(expiresAt)}</span>
              </div>

              <h1 className="mt-4 max-w-2xl text-[2rem] font-black leading-[0.98] tracking-[-0.04em] text-white sm:text-[2.65rem]">
                {displayTitle}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-200 sm:text-[15px]">
                {primaryMessage}
              </p>
              <p className="mt-2 max-w-xl text-sm leading-6 text-zinc-400 sm:text-[15px]">
                {secondaryMessage}
              </p>

              <div className="mt-5 flex flex-col gap-3 sm:mt-6 sm:max-w-md">
                <button
                  type="button"
                  onClick={onShowDemo}
                  className="inline-flex min-h-14 w-full items-center justify-center rounded-2xl bg-red-600 px-5 text-base font-semibold text-white shadow-[0_18px_45px_rgba(239,68,68,0.35)] transition hover:bg-red-500"
                >
                  {primaryCta}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </section>

        <section id="listing-play-demo" className="px-4 py-2 sm:px-6">
          <div className="mx-auto max-w-5xl rounded-[28px] border border-white/10 bg-white/[0.04] p-4 shadow-[0_22px_70px_rgba(0,0,0,0.3)] sm:p-6">
            <div className="max-w-2xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-red-200">
                Quick look
              </p>
              <h2 className="mt-2 text-2xl font-black tracking-[-0.03em] text-white sm:text-[2rem]">
                See how WolfGrid helps you find your next client
              </h2>
              <p className="mt-2 text-sm leading-6 text-zinc-400 sm:text-[15px]">
                Use one listing to power a smarter local campaign with flyers, doorknocking, tracking, and follow-up built in.
              </p>
            </div>
            <div className="mt-4 overflow-hidden rounded-[24px] border border-white/10 bg-black/30 p-4 sm:p-6">
              <ExclusiveOfferArcadeEmbed
                variant="iphone"
                instance={demoInstance}
                mode="modal"
                open={isDemoOpen}
                onOpenChange={onDemoOpenChange}
              />
            </div>
            <div className="mt-5 sm:max-w-md">
              <button
                type="button"
                onClick={onGetStarted}
                className="inline-flex min-h-14 w-full items-center justify-center rounded-2xl bg-white px-5 text-base font-semibold text-zinc-950 transition hover:bg-zinc-100"
              >
                Continue with one campaign included
                <ArrowRight className="ml-2 h-4 w-4" />
              </button>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export function PartnerOfferLanding({
  offerTitle,
  offerMessage,
  partnerName,
  recipientName,
  expiresAt,
  ctaLabel,
  offerToken,
  partnerOnboardingTeamStyle,
}: PartnerOfferLandingProps) {
  const [trackingWordIndex, setTrackingWordIndex] = useState(0);
  const [demoInstance, setDemoInstance] = useState(0);
  const [isJustListedDemoOpen, setIsJustListedDemoOpen] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      setTrackingWordIndex((i) => (i + 1) % TRACKING_WORDS.length);
    }, 2200);
    return () => clearInterval(id);
  }, []);

  const handleGetStarted = async () => {
    window.location.href = partnerOnboardingHref(
      offerToken,
      partnerOnboardingTeamStyle,
      offerTitle,
      offerMessage
    );
  };

  const handleShowDemo = () => {
    setDemoInstance((current) => current + 1);
    setIsJustListedDemoOpen(true);
  };

  /** Same Arcade as Just Listed DM template (iPhone walkthrough), not the team dashboard embed. */
  const useDmTemplateArcadeDemo =
    /30\s*day\s*challenge/i.test(offerTitle) ||
    /private access to the challenge/i.test(offerMessage ?? '');

  if (isJustListedDmOffer(offerTitle, offerMessage)) {
    return (
      <JustListedDmOfferLanding
        offerTitle={offerTitle}
        offerMessage={offerMessage}
        partnerOnboardingTeamStyle={partnerOnboardingTeamStyle}
        partnerName={partnerName}
        recipientName={recipientName}
        expiresAt={expiresAt}
        ctaLabel={ctaLabel}
        demoInstance={demoInstance}
        isDemoOpen={isJustListedDemoOpen}
        onGetStarted={handleGetStarted}
        onShowDemo={handleShowDemo}
        onDemoOpenChange={setIsJustListedDemoOpen}
      />
    );
  }

  return (
    <div
      className={
        useDmTemplateArcadeDemo
          ? 'min-h-screen bg-[#09090b] text-white'
          : 'min-h-screen bg-zinc-50 text-zinc-900'
      }
    >
      <header
        className={
          useDmTemplateArcadeDemo
            ? 'sticky top-0 z-50 border-b border-white/10 bg-black/55 backdrop-blur-md'
            : 'sticky top-0 z-50 border-b border-zinc-200/80 bg-zinc-50/90 backdrop-blur-sm'
        }
      >
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3 md:px-6">
          <Link href="/" className="flex items-end">
            <span className="text-3xl font-black leading-none tracking-tight text-red-500 sm:text-4xl md:text-5xl">WolfGrid</span>
          </Link>

          <div className="flex items-center gap-4 md:gap-6">
            <Link
              href="/download"
              className={
                useDmTemplateArcadeDemo
                  ? 'text-sm font-medium text-zinc-400 transition hover:text-white'
                  : 'text-sm font-medium text-zinc-600 transition hover:text-zinc-900'
              }
            >
              Download
            </Link>
            <span
              className={
                useDmTemplateArcadeDemo ? 'text-sm font-semibold text-red-400' : 'text-sm font-semibold text-red-600'
              }
            >
              Exclusive Offer
            </span>
            <Link
              href="/login"
              className={
                useDmTemplateArcadeDemo
                  ? 'inline-flex h-9 items-center rounded-lg border border-white/15 bg-white/5 px-4 text-sm font-semibold text-white transition hover:bg-white/10'
                  : 'inline-flex h-9 items-center rounded-lg border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-100'
              }
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section
          className={
            useDmTemplateArcadeDemo
              ? 'relative overflow-hidden px-4 pb-8 pt-8 sm:px-6 sm:pb-10 sm:pt-10'
              : 'relative overflow-hidden px-5 py-24 md:px-8 md:py-32'
          }
        >
          {useDmTemplateArcadeDemo ? (
            <div className="mx-auto max-w-5xl">
              <div className="overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(239,68,68,0.18),_rgba(24,24,27,0.96)_42%)] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)] sm:p-6">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs font-medium text-zinc-400 sm:text-sm">
                  <span>{partnerName}</span>
                  {recipientName ? <span>For {recipientName}</span> : null}
                  <span>Expires {formatLongDate(expiresAt)}</span>
                </div>
                <h1 className="mt-4 text-[2rem] font-black leading-[0.98] tracking-[-0.04em] text-white sm:text-[2.65rem]">
                  {offerTitle}
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-200 sm:text-[15px]">
                  {offerMessage || 'This exclusive page was shared directly with your team.'}
                </p>
                <p className="mt-6 flex flex-wrap items-center text-xl font-semibold text-white sm:text-2xl" aria-live="polite">
                  <span>Start tracking</span>
                  <span className="ml-1 inline-flex w-[min(12ch,100%)] justify-start">
                    <span key={trackingWordIndex} className="inline-block animate-hero-word-in text-red-500">
                      {TRACKING_WORDS[trackingWordIndex]}
                    </span>
                  </span>
                </p>
                <div className="mt-8 flex flex-wrap gap-4">
                  <button
                    type="button"
                    onClick={handleGetStarted}
                    className="inline-flex min-h-12 items-center rounded-2xl bg-red-600 px-6 text-base font-semibold text-white shadow-[0_18px_45px_rgba(239,68,68,0.35)] transition hover:bg-red-500"
                  >
                    {ctaLabel?.trim() || 'Activate'}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="mx-auto flex max-w-7xl flex-col items-center text-center">
              <div className="w-full max-w-4xl">
                <div className="mb-4 text-sm font-medium text-zinc-600">
                  {partnerName}
                  {recipientName ? ` • For ${recipientName}` : ''}
                </div>
                <h1 className="text-5xl font-black leading-tight text-zinc-900 md:text-6xl">{offerTitle}</h1>
                <p className="mx-auto mt-6 max-w-3xl text-lg text-zinc-600">
                  {offerMessage || 'This exclusive page was shared directly with your team.'}
                </p>
                <p className="mt-3 text-sm text-zinc-500">Offer expires {formatLongDate(expiresAt)}</p>

                <p className="mt-6 flex items-center justify-center text-2xl font-semibold text-zinc-900" aria-live="polite">
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
                    {ctaLabel?.trim() || 'Activate'}
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="pb-0 pt-0">
          {useDmTemplateArcadeDemo ? (
            <div className="py-10 sm:py-12">
              <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
                <div className="rounded-[28px] border border-white/10 bg-white/[0.04] p-4 shadow-[0_22px_70px_rgba(0,0,0,0.3)] sm:p-6">
                  <div className="max-w-2xl">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-red-200">
                      Quick look
                    </p>
                    <h2 className="mt-2 text-2xl font-black tracking-[-0.03em] text-white sm:text-[2rem]">
                      See how WolfGrid helps you find your next client
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-zinc-400 sm:text-[15px]">
                      Use one listing to power a smarter local campaign with flyers, doorknocking, tracking, and follow-up built in.
                    </p>
                  </div>
                  <div className="mt-4 overflow-hidden rounded-[24px] border border-white/10 bg-black/30 p-4 sm:p-6">
                    <ExclusiveOfferArcadeEmbed
                      variant="iphone"
                      mode="modal"
                      instance={demoInstance}
                      open={isJustListedDemoOpen}
                      onOpenChange={setIsJustListedDemoOpen}
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="mx-auto w-full max-w-7xl px-5 md:px-8">
              <h2 className="text-center text-3xl font-black leading-tight text-zinc-900 md:text-4xl">
                See WolfGrid in action
              </h2>
              <p className="mt-3 text-center text-lg text-zinc-500">
                The same WolfGrid platform, with exclusive terms for your team.
              </p>
              <div className="mx-auto mt-8 w-full max-w-6xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
                <ExclusiveOfferArcadeEmbed variant="default" />
              </div>
            </div>
          )}
        </section>

        <section
          className={
            useDmTemplateArcadeDemo
              ? 'border-t border-white/5 px-5 pb-14 pt-10 md:px-8 md:pb-16'
              : 'px-5 pb-14 pt-10 md:px-8 md:pb-16'
          }
        >
          <div className="mx-auto flex max-w-7xl flex-col items-center text-center">
            <p
              className={
                useDmTemplateArcadeDemo ? 'text-lg font-medium text-zinc-300' : 'text-lg font-medium text-zinc-700'
              }
            >
              Ready to lock in your exclusive partner access?
            </p>
            <button
              type="button"
              onClick={handleGetStarted}
              className="mt-4 inline-flex h-12 items-center rounded-2xl bg-red-600 px-6 text-base font-semibold text-white transition hover:bg-red-500"
            >
              {ctaLabel?.trim() || 'Claim Free Access'}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
