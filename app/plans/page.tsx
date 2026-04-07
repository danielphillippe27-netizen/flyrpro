import Link from 'next/link';
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

export default function PlansPage() {
  const loginRedirect = `/login?redirect=${encodeURIComponent('/pricing')}`;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="sticky top-0 z-40 border-b border-zinc-200/80 bg-zinc-50/90 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-3 md:px-6">
          <Link href="/" className="text-3xl font-black leading-none tracking-tight text-red-600 md:text-4xl">
            FLYR
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex h-9 items-center rounded-lg bg-zinc-100 px-4 text-sm font-semibold text-zinc-900 transition hover:bg-zinc-200"
            >
              Home
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
                  <p className="text-center text-base font-semibold text-zinc-800">
                    CA$39.99 / month
                  </p>
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
                  <p className="text-center text-base font-semibold text-zinc-800">
                    CA$79.99 / month + CA$30 per seat
                  </p>
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
