'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Check, Zap, MapPin, QrCode, BarChart3, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface PriceOption {
  priceId: string;
  name: string;
  amount: string;
  period: string;
  currency: 'USD' | 'CAD';
  interval: 'month' | 'year';
}

export default function PricingPage() {
  const router = useRouter();
  const [prices, setPrices] = useState<PriceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/billing/prices')
      .then((res) => res.json())
      .then((data) => setPrices(data.prices || []))
      .catch(() => setPrices([]))
      .finally(() => setLoading(false));
  }, []);

  const handleSelectPlan = async (priceId: string) => {
    setCheckoutLoading(priceId);
    try {
      const res = await fetch('/api/billing/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ priceId }),
      });
      const data = await res.json();
      if (res.status === 401) {
        router.push(`/login?redirect=${encodeURIComponent('/pricing')}`);
        return;
      }
      if (data.url) {
        window.location.href = data.url;
      } else {
        router.push('/billing');
      }
    } catch {
      router.push('/billing');
    } finally {
      setCheckoutLoading(null);
    }
  };

  const symbol = (c: string) => (c === 'USD' ? '$' : 'CA$');
  const usdPlans = prices.filter((p) => p.currency === 'USD');
  const cadPlans = prices.filter((p) => p.currency === 'CAD');

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
          Start free. Upgrade to Pro when you need more.
        </p>

        {loading ? (
          <div className="mx-auto mt-12 max-w-4xl text-center text-muted-foreground">
            Loading plans…
          </div>
        ) : (
          <div className="mx-auto mt-12 grid max-w-4xl gap-8 sm:grid-cols-2">
            {/* Free */}
            <Card className="flex flex-col">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Free
                </CardTitle>
                <CardDescription>
                  Get started with core features
                </CardDescription>
                <div className="mt-4">
                  <span className="text-3xl font-bold">$0</span>
                  <span className="text-muted-foreground">/month</span>
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                <ul className="space-y-2 text-sm">
                  {['Campaigns & territories', 'QR codes (limits apply)', 'Map view', 'Basic stats'].map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-green-500" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button variant="outline" className="mt-auto" asChild>
                  <Link href="/home">Get started</Link>
                </Button>
              </CardContent>
            </Card>

            {/* Pro */}
            <Card className="flex flex-col border-primary shadow-md">
              <CardHeader>
                <Badge className="w-fit">Pro</Badge>
                <CardTitle className="flex items-center gap-2">
                  Pro
                </CardTitle>
                <CardDescription>
                  Unlimited QR codes and advanced features
                </CardDescription>
                <div className="mt-4 text-muted-foreground">
                  Choose plan below
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                <ul className="space-y-2 text-sm">
                  {['Everything in Free', 'Unlimited QR codes', 'ZIP export for print', 'Priority support'].map((f) => (
                    <li key={f} className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-green-500" />
                      {f}
                    </li>
                  ))}
                </ul>
                {prices.length === 0 ? (
                  <Button className="mt-auto" asChild>
                    <Link href="/billing">
                      Upgrade to Pro
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                ) : (
                  <div className="mt-auto space-y-2">
                    {usdPlans.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">USD</p>
                        {usdPlans.map((p) => (
                          <Button
                            key={p.priceId}
                            className="w-full"
                            onClick={() => handleSelectPlan(p.priceId)}
                            disabled={checkoutLoading !== null}
                          >
                            {checkoutLoading === p.priceId
                              ? 'Redirecting…'
                              : `${symbol(p.currency)}${p.amount}${p.period}${p.interval === 'year' ? ' (billed yearly)' : ''}`}
                          </Button>
                        ))}
                      </div>
                    )}
                    {cadPlans.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-muted-foreground">CAD</p>
                        {cadPlans.map((p) => (
                          <Button
                            key={p.priceId}
                            variant="outline"
                            className="w-full"
                            onClick={() => handleSelectPlan(p.priceId)}
                            disabled={checkoutLoading !== null}
                          >
                            {checkoutLoading === p.priceId
                              ? 'Redirecting…'
                              : `${symbol(p.currency)}${p.amount}${p.period}${p.interval === 'year' ? ' (billed yearly)' : ''}`}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
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
