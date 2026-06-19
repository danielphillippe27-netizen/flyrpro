import Link from 'next/link';
import { PublicSiteHeader } from '@/components/landing/PublicSiteHeader';
import { PricingCard } from '@/components/pricing/PricingCard';
import { TeamSeatSelector } from '@/components/pricing/TeamSeatSelector';

const proFeatures = [
  { text: 'iOS + Desktop dashboard' },
  { text: 'Unlimited campaigns' },
  { text: 'Unlimited contacts / leads' },
  { text: 'Advanced optimized routing (smart street order + walkable flow)' },
  { text: 'Address-level QR tracking (exact house that scanned)' },
  { text: 'Unlimited QR codes (bulk generator)' },
  { text: 'Track performance' },
  { text: 'Doors knocked, convos, follow-ups, scans' },
  { text: 'Follow-up system (tasks, reminders, call list)' },
  { text: 'Exports (CSV / CRM-ready)' },
  { text: 'Leaderboards + activity feed' },
  { text: 'CRM integrations (Follow Up Boss / kvCORE / BoldTrail / HubSpot)' },
];

const teamFeatures = [
  { text: 'Everything in Pro', bold: true },
  { text: 'Simple per-user seat pricing' },
  { text: 'Invite / remove team members' },
  { text: 'Roles & permissions (Admin, Member)' },
  { text: 'Assign territories & campaigns to teammates' },
  { text: 'Shared progress + activity feed' },
  { text: 'Team leaderboards' },
  { text: 'Team analytics (by member, by campaign)' },
  { text: 'Centralized billing' },
  { text: 'Priority support' },
];

export default function PlansPage() {
  const loginRedirect = `/login?redirect=${encodeURIComponent('/pricing')}`;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <PublicSiteHeader active="pricing" />

      <main className="px-5 py-20 md:px-8">
        <div className="mx-auto max-w-5xl">
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-red-600">Pricing</p>
            <h1 className="mt-3 text-4xl font-black md:text-5xl">Pick your plan</h1>
            <p className="mt-3 text-lg text-zinc-500">Simple pricing. Scale when you&apos;re ready.</p>
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-2">
            <PricingCard
              title="Pro"
              subtitle="For serious flyer volume."
              features={proFeatures}
              cta={
                <>
                  <div className="text-center text-base font-semibold text-zinc-800">
                    <p className="text-xs uppercase tracking-[0.2em] text-emerald-600">
                      50% off
                    </p>
                    <p className="mt-1">
                      <span className="mr-2 text-zinc-400 line-through">
                        CA$80
                      </span>
                      CA$40 / month
                    </p>
                    <p className="text-sm text-zinc-500">
                      or{' '}
                      <span className="mr-1 text-zinc-400 line-through">
                        $60 USD
                      </span>
                      $30 USD / month
                    </p>
                  </div>
                  <Link
                    href={loginRedirect}
                    className="inline-flex h-11 w-full items-center justify-center rounded-2xl bg-zinc-900 text-sm font-semibold text-white transition hover:bg-zinc-700"
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
                  <Link
                    href={loginRedirect}
                    className="inline-flex h-11 w-full items-center justify-center rounded-2xl bg-zinc-900 text-sm font-semibold text-white transition hover:bg-zinc-700"
                  >
                    Start team
                  </Link>
                </>
              }
            />
          </div>
        </div>
      </main>
    </div>
  );
}
