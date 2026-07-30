import Link from 'next/link';
import { ArrowRight, Check, HelpCircle } from 'lucide-react';
import { PublicSiteFooter } from '@/components/landing/PublicSiteFooter';
import { PublicSiteHeader } from '@/components/landing/PublicSiteHeader';
import { PricingCard } from '@/components/pricing/PricingCard';
import { TeamSeatSelector } from '@/components/pricing/TeamSeatSelector';

const proFeatures = [
  { text: 'iOS + Android + desktop dashboard' },
  { text: 'Unlimited campaigns and contacts' },
  { text: 'Optimized routing and walkable flow' },
  { text: 'Address-level QR tracking' },
  { text: 'Tasks, reminders, and follow-up lists' },
  { text: 'CSV and CRM-ready exports' },
  { text: 'Leaderboards and activity feed' },
  { text: 'CRM integrations' },
];

const teamFeatures = [
  { text: 'Everything in Pro', bold: true },
  { text: 'Invite and manage team members' },
  { text: 'Admin and member permissions' },
  { text: 'Assign territories and campaigns' },
  { text: 'Shared progress and activity feed' },
  { text: 'Team leaderboards and analytics' },
  { text: 'Centralized billing' },
  { text: 'Priority support' },
];

const comparisonRows = [
  ['Campaigns', 'Unlimited', 'Unlimited'],
  ['Contacts and leads', 'Unlimited', 'Unlimited'],
  ['Advanced route optimization', 'Included', 'Included'],
  ['Team assignments', '—', 'Included'],
  ['Roles and permissions', '—', 'Included'],
  ['Team analytics', '—', 'Included'],
  ['Priority support', '—', 'Included'],
];

const faqs = [
  ['Can I try WolfGrid before paying?', 'Yes. Start with one campaign and explore the core workflow before choosing a paid plan.'],
  ['Does WolfGrid work on mobile and desktop?', 'Yes. Use the desktop dashboard to plan and manage, then take the iOS or Android app into the field.'],
  ['Can I add teammates later?', 'Yes. You can move to the Team plan when you are ready to assign territories and share progress.'],
  ['What happens to the launch price?', 'The displayed promotional price is for early customers. Your checkout will show the current applicable terms before purchase.'],
];

export default function PlansPage() {
  const loginRedirect = `/login?redirect=${encodeURIComponent('/pricing')}`;

  return (
    <div className="min-h-screen bg-[#f7f5f2] text-zinc-950">
      <PublicSiteHeader active="pricing" />

      <main>
        <section className="relative overflow-hidden px-5 pb-16 pt-16 md:px-8 md:pb-24 md:pt-24">
          <div className="pointer-events-none absolute left-1/2 top-0 h-96 w-[760px] -translate-x-1/2 rounded-full bg-red-500/10 blur-[110px]" />
          <div className="relative mx-auto max-w-4xl text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-red-600">Simple pricing</p>
            <h1 className="mt-5 text-5xl font-black leading-[0.98] tracking-[-0.05em] md:text-7xl">
              Start solo. Scale as a team.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-zinc-600">
              One connected system for territory planning, field activity, follow-up, and performance.
            </p>
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2 text-xs font-bold text-zinc-600">
              <Check className="h-3.5 w-3.5 text-emerald-600" /> One campaign included before you subscribe
            </div>
          </div>
        </section>

        <section className="px-5 pb-24 md:px-8 md:pb-32">
          <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-2">
            <PricingCard
              title="Pro"
              subtitle="For independent operators building a consistent prospecting system."
              badge="50% off launch pricing"
              priceDisplay={
                <div className="rounded-2xl border border-zinc-200 bg-[#f7f5f2] p-5">
                  <p className="text-4xl font-black tracking-tight text-zinc-950">
                    $30 USD <span className="text-sm font-bold text-zinc-500">/ month</span>
                  </p>
                  <p className="mt-1 text-sm font-semibold text-zinc-500">
                    Normally <span className="line-through">$60 USD / month</span>
                  </p>
                  <p className="mt-2 text-xs text-zinc-500">CA$40 / month, normally CA$80</p>
                </div>
              }
              features={proFeatures}
              cta={
                <Link
                  href={loginRedirect}
                  className="inline-flex h-12 w-full items-center justify-center rounded-full bg-zinc-950 text-sm font-bold text-white transition hover:bg-red-600"
                >
                  Start Pro <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              }
            />
            <PricingCard
              title="Team"
              subtitle="For managers who need collaboration, ownership, and accountability."
              badge="Most popular"
              highlighted
              features={teamFeatures}
              priceDisplay={<TeamSeatSelector />}
              cta={
                <Link
                  href={loginRedirect}
                  className="inline-flex h-12 w-full items-center justify-center rounded-full bg-red-600 text-sm font-bold text-white transition hover:bg-red-500"
                >
                  Start a team <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              }
            />
          </div>
        </section>

        <section className="bg-white px-5 py-20 md:px-8 md:py-28">
          <div className="mx-auto max-w-5xl">
            <div className="max-w-2xl">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-red-600">Compare plans</p>
              <h2 className="mt-4 text-4xl font-black tracking-[-0.04em] md:text-5xl">Everything you need to decide.</h2>
            </div>
            <div className="mt-10 overflow-hidden rounded-[2rem] border border-zinc-200">
              <div className="grid grid-cols-[1.3fr_0.7fr_0.7fr] bg-zinc-950 px-5 py-4 text-xs font-bold uppercase tracking-[0.15em] text-white md:px-7">
                <span>Feature</span>
                <span>Pro</span>
                <span>Team</span>
              </div>
              {comparisonRows.map(([feature, pro, team]) => (
                <div key={feature} className="grid grid-cols-[1.3fr_0.7fr_0.7fr] border-t border-zinc-200 px-5 py-4 text-sm md:px-7">
                  <span className="font-semibold text-zinc-900">{feature}</span>
                  <span className="text-zinc-600">{pro}</span>
                  <span className="font-semibold text-zinc-900">{team}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-5 py-20 md:px-8 md:py-28">
          <div className="mx-auto grid max-w-5xl gap-12 lg:grid-cols-[0.7fr_1.3fr]">
            <div>
              <HelpCircle className="h-8 w-8 text-red-600" />
              <h2 className="mt-5 text-4xl font-black tracking-[-0.04em]">Questions, answered.</h2>
              <p className="mt-4 leading-7 text-zinc-600">Everything you need to know before putting your first campaign on the grid.</p>
            </div>
            <div className="divide-y divide-zinc-200 border-y border-zinc-200">
              {faqs.map(([question, answer]) => (
                <div key={question} className="py-6">
                  <h3 className="font-bold text-zinc-950">{question}</h3>
                  <p className="mt-2 text-sm leading-6 text-zinc-600">{answer}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="bg-red-600 px-5 py-16 text-white md:px-8 md:py-20">
          <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-7 text-center md:flex-row md:text-left">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-red-100">Ready when you are</p>
              <h2 className="mt-3 text-3xl font-black tracking-tight md:text-4xl">Start with your next territory.</h2>
            </div>
            <Link href="/login" className="inline-flex h-12 items-center justify-center rounded-full bg-white px-7 text-sm font-bold text-zinc-950 transition hover:bg-zinc-100">
              Start free <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>

      <PublicSiteFooter />
    </div>
  );
}
