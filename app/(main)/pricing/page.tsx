'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Zap, MapPin, QrCode, BarChart3 } from 'lucide-react';
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
  const [prices, setPrices] = useState<PriceOption[]>([]);
  const [loading, setLoading] = useState(true);

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
          <div className="mx-auto mt-12 grid max-w-4xl gap-8 sm:grid-cols-2">
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
                { text: 'CRM integrations (Follow Up Boss / webhook)' },
                { text: 'Priority support' },
              ]}
              cta={
                <>
                  <p className="text-center text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                    CA$39.99 / month
                  </p>
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
                { text: '2 seats included in base price' },
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
                  <p className="text-center text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                    CA$79.99 / month + CA$30 per seat
                  </p>
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
