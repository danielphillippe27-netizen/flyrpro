'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowRight, Zap, MapPin, QrCode, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PricingCard } from '@/components/pricing/PricingCard';
import { TeamSeatSelector } from '@/components/pricing/TeamSeatSelector';

interface PriceOption {
  priceId: string;
  name: string;
  amount: string;
  period: string;
  currency: 'USD' | 'CAD';
  interval: 'month' | 'year';
}

export default function PricingPage() {
  const searchParams = useSearchParams();
  const [, setPrices] = useState<PriceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const isSelfServeDemo = searchParams.get('source') === 'self-serve-demo';
  const campaignId = searchParams.get('campaign');
  const demoSettingsParams = new URLSearchParams({
    tab: 'settings',
    source: 'self-serve-demo',
    demoReport: '1',
  });

  if (campaignId) {
    demoSettingsParams.set('campaign', campaignId);
  }

  const demoSettingsHref = `/home?${demoSettingsParams.toString()}`;

  useEffect(() => {
    fetch('/api/billing/prices')
      .then((res) => res.json())
      .then((data) => setPrices(data.prices || []))
      .catch(() => setPrices([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-full bg-gradient-to-b from-background to-muted/20">
      {/* Hero */}
      <section className="border-b bg-card/50 px-6 py-16 text-center">
        <Badge variant="secondary" className="mb-4">
          Simple pricing
        </Badge>
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl dark:text-white">
          Territory & campaign tools for door knockers
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
          Create campaigns, map territories, generate QR codes, and track scans—all in one place. Upgrade to Pro for unlimited QR codes and advanced features.
        </p>
      </section>

      {isSelfServeDemo ? (
        <section className="border-b bg-background px-6 py-4">
          <div className="mx-auto flex max-w-5xl flex-col gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-left shadow-sm dark:border-red-900/50 dark:bg-red-950/20 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <Badge variant="outline" className="border-red-200 bg-white text-red-700 dark:border-red-900/70 dark:bg-background dark:text-red-300">
                Step 4 of 6
              </Badge>
              <p className="mt-2 text-sm font-medium text-slate-950 dark:text-white">
                Pricing is ready. Next, show team settings before the final feedback step.
              </p>
            </div>
            <Button asChild className="shrink-0">
              <Link href={demoSettingsHref} data-self-serve-demo-flow="true">
                Continue to step 5
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </section>
      ) : null}

      {/* Benefits */}
      <section className="px-6 py-12">
        <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: MapPin, title: 'Map territories', desc: 'Draw and manage campaign areas' },
            { icon: QrCode, title: 'QR codes', desc: 'Generate and track scan activity' },
            { icon: BarChart3, title: 'Campaign stats', desc: 'Progress and conversion metrics' },
            { icon: Zap, title: 'Pro features', desc: 'Unlimited QRs, ZIP export, more' },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="flex gap-3 rounded-lg border bg-card p-4">
              <Icon className="h-5 w-5 shrink-0 text-primary" />
              <div>
                <p className="font-medium">{title}</p>
                <p className="text-sm text-muted-foreground">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="px-6 pb-20 pt-4" id="pricing">
        <h2 className="text-center text-2xl font-semibold dark:text-white">Choose your plan</h2>
        <p className="mt-2 text-center text-muted-foreground">
          Simple pricing. Scale when you&apos;re ready.
        </p>

        {loading ? (
          <div className="mx-auto mt-12 max-w-4xl text-center text-muted-foreground">
            Loading plans…
          </div>
        ) : (
          <div className="mx-auto mt-12 grid max-w-6xl gap-8 lg:grid-cols-3">
            <PricingCard
              title="Free"
              subtitle="Create your first WolfGrid map and see the workflow."
              features={[
                { text: 'One campaign', bold: true },
                { text: 'One prospecting map' },
                { text: 'Campaign dashboard preview' },
                { text: 'Mock members and assignments' },
                { text: 'Basic reporting tour' },
              ]}
              cta={
                <>
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-center text-sm font-semibold text-zinc-700">
                    <p className="text-3xl font-black text-zinc-950">
                      $0 <span className="text-base font-bold text-zinc-700">/ forever</span>
                    </p>
                    <p className="mt-1 text-zinc-600">Upgrade when you need more campaigns.</p>
                  </div>
                  <Button className="w-full" variant="outline" asChild>
                    <Link href="/demo-1">Create FREE WolfGrid Map</Link>
                  </Button>
                </>
              }
            />
            <PricingCard
              title="Pro"
              subtitle="For serious flyer volume."
              features={[
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
                { text: 'CRM integrations (Follow Up Boss / kvCORE / BoldTrail / HubSpot)' },
                { text: 'Priority support' },
              ]}
              cta={
                <>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center text-sm font-semibold text-zinc-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-zinc-200">
                    <p className="inline-flex rounded-full bg-emerald-600 px-3 py-1 text-xs uppercase tracking-[0.18em] text-white dark:bg-emerald-500 dark:text-emerald-950">
                      50% off launch pricing
                    </p>
                    <p className="mt-4 text-3xl font-black text-zinc-950 dark:text-white">
                      $30 USD <span className="text-base font-bold text-zinc-700 dark:text-zinc-300">/ month</span>
                    </p>
                    <p className="mt-1 text-zinc-600 dark:text-zinc-300">
                      Normally{' '}
                      <span className="font-bold text-zinc-400 line-through dark:text-zinc-500">
                        $60 USD / month
                      </span>
                    </p>
                    <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
                      CA$40 / month, normally <span className="text-zinc-400 line-through dark:text-zinc-500">CA$80</span>
                    </p>
                  </div>
                  <Button className="w-full" asChild>
                    <Link href="/billing">Get started</Link>
                  </Button>
                </>
              }
            />
            <PricingCard
              title="Team"
              subtitle="Collaboration + accountability for small teams."
              features={[
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
              ]}
              cta={
                <>
                  <TeamSeatSelector />
                  <Button className="w-full" asChild>
                    <Link href="/billing">Start team</Link>
                  </Button>
                </>
              }
            />
          </div>
        )}
      </section>

      {/* CTA */}
      <section className="border-t bg-muted/30 px-6 py-12 text-center">
        <p className="text-muted-foreground">
          Already have a subscription?{' '}
          <Link href="/billing" className="font-medium text-primary underline underline-offset-4">
            Manage billing
          </Link>
        </p>
      </section>
    </div>
  );
}
