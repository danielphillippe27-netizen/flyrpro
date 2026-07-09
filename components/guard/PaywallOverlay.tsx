'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { AlertCircle, LogOut, Monitor, Flag, QrCode, Link, Calendar, RefreshCw, Map, MoreHorizontal } from 'lucide-react';
import { getClientAsync } from '@/lib/supabase/client';

type AccessState = {
  role: string | null;
  workspaceName: string | null;
  maxSeats?: number;
  billableSeats?: number;
  hasAccess: boolean;
  reason?: string;
};

const FEATURES = [
  { icon: Monitor, label: 'Desktop Dashboard' },
  { icon: Flag, label: 'Unlimited Campaigns' },
  { icon: QrCode, label: 'Advanced QR codes' },
  { icon: Link, label: 'CRM Integration' },
  { icon: Calendar, label: 'Set Appointments' },
  { icon: RefreshCw, label: "Create Follow Up's" },
  { icon: Map, label: 'Optimized routes' },
  { icon: MoreHorizontal, label: '& much more' },
] as const;

export function PaywallOverlay() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<AccessState | null>(null);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [plan, setPlan] = useState<'annual' | 'monthly'>('annual');
  const [currency, setCurrency] = useState<'USD' | 'CAD'>('USD');
  const seats = Math.max(1, state?.billableSeats ?? state?.maxSeats ?? 1);

  const annualBase = currency === 'CAD' ? 400 : 300;
  const annualRetailBase = annualBase * 2;
  const annualMonthlyEquivalent = annualBase / 12;
  const annualTotal = annualBase * seats;
  const monthlyPrice = currency === 'CAD' ? 40 : 30;
  const monthlyRetailPrice = monthlyPrice * 2;
  const monthlyTotal = monthlyPrice * seats;
  const monthlyRetailTotal = monthlyRetailPrice * seats;

  useEffect(() => {
    let mounted = true;
    const q = searchParams.get('currency');
    const url = q === 'CAD' || q === 'USD' ? `/api/currency?currency=${q}` : '/api/currency';
    fetch(url, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : { currency: 'USD' }))
      .then((data) => {
        if (mounted && data?.currency) setCurrency(data.currency);
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, [searchParams]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      const supabase = await getClientAsync();
      await supabase.auth.signOut();
      router.push('/login');
    } catch {
      setSigningOut(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    fetch('/api/access/state', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (mounted) setState(data);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const handleCheckout = async () => {
    setCheckoutError(null);
    setCheckoutLoading(true);
    try {
      const checkoutRes = await fetch('/api/billing/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ plan, currency, seats }),
      });
      const data = await checkoutRes.json().catch(() => ({}));
      if (checkoutRes.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      if (checkoutRes.status === 400 && data?.error?.includes('Valid price')) {
        setCheckoutError('Checkout is not configured for this plan. Please try again later.');
      } else {
        setCheckoutError(data?.error ?? 'Failed to start checkout.');
      }
    } catch {
      setCheckoutError('Network error. Please try again.');
    } finally {
      setCheckoutLoading(false);
    }
  };

  if (!state) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 backdrop-blur-md">
        <div className="rounded-2xl bg-card p-8 shadow-xl border border-border">
          <p className="text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }

  if (state.hasAccess) {
    return null;
  }

  const isMemberInactive =
    state.reason === 'member-inactive' ||
    (state.role !== 'owner' && !state.hasAccess);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/65 backdrop-blur-md p-4"
      aria-modal
      role="dialog"
      aria-labelledby="paywall-title"
    >
      <div className="relative w-full max-w-xl rounded-2xl border border-border bg-card/95 dark:bg-zinc-900/95 p-8 shadow-2xl">
        {isMemberInactive ? (
          <div className="text-center space-y-4">
            <div className="flex justify-center">
              <AlertCircle className="h-12 w-12 text-amber-500" />
            </div>
            <h1 id="paywall-title" className="text-xl font-semibold text-foreground">
              Workspace subscription inactive
            </h1>
            <p className="text-muted-foreground text-sm">
              {state.workspaceName
                ? `${state.workspaceName} does not have an active subscription.`
                : 'This workspace does not have an active subscription.'}{' '}
              Contact your workspace owner to renew so you can access the dashboard.
            </p>
            <div className="flex justify-center pt-2">
              <Button variant="outline" onClick={handleSignOut} disabled={signingOut} className="gap-2">
                <LogOut className="h-4 w-4" />
                {signingOut ? 'Signing out…' : 'Sign out'}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="text-center space-y-3">
              <h1 id="paywall-title" className="text-5xl font-bold text-foreground">
                Upgrade to create more campaigns.
              </h1>
              <p className="text-muted-foreground text-xl">
                Your first workspace campaign is included. Choose a plan when you are ready to scale.
              </p>
            </div>

            <p className="mt-6 text-center">
              <button
                type="button"
                onClick={() => setCurrency((c) => (c === 'USD' ? 'CAD' : 'USD'))}
                className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                {currency === 'USD' ? 'Show prices in CAD' : 'Show prices in USD'}
              </button>
            </p>

            <div className="mt-6 space-y-2">
              <button
                type="button"
                onClick={() => setPlan('annual')}
                className={`w-full flex items-center justify-between rounded-xl border-2 px-4 py-3 text-left transition-colors ${
                  plan === 'annual'
                    ? 'border-primary bg-primary/10 dark:bg-primary/20'
                    : 'border-border bg-muted/30 hover:border-muted-foreground/30'
                }`}
              >
                <div>
                  <p className="font-semibold text-foreground">Annual</p>
                  <p className="text-xs text-muted-foreground">
                    Billed at ${annualTotal.toFixed(2)}/year for {seats} seat{seats === 1 ? '' : 's'}
                    <span className="ml-1 text-[10px] uppercase text-muted-foreground">{currency}</span>
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600 dark:text-emerald-300">
                    50% off early bird
                  </p>
                  <p className="font-semibold text-foreground">
                    <span className="mr-2 text-sm font-normal text-muted-foreground line-through">
                      ${(annualRetailBase / 12 * seats).toFixed(2)}
                    </span>
                    ~${(annualMonthlyEquivalent * seats).toFixed(2)}/month
                    <span className="ml-1 text-[10px] font-normal uppercase text-muted-foreground">{currency}</span>
                  </p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setPlan('monthly')}
                className={`w-full flex items-center justify-between rounded-xl border-2 px-4 py-3 text-left transition-colors ${
                  plan === 'monthly'
                    ? 'border-primary bg-primary/10 dark:bg-primary/20'
                    : 'border-border bg-muted/30 hover:border-muted-foreground/30'
                }`}
              >
                <div>
                  <p className="font-semibold text-foreground">Monthly</p>
                  <p className="text-xs text-muted-foreground">
                    {seats} seat{seats === 1 ? '' : 's'}
                  </p>
                  <p className="text-xs text-muted-foreground">Founding Team Pricing</p>
                </div>
                <p className="font-semibold text-foreground text-right">
                  <span className="flex flex-col items-end">
                    <span className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600 dark:text-emerald-300">
                      50% off early bird
                    </span>
                    <span className="line-through text-muted-foreground text-sm font-normal">
                      ${monthlyRetailTotal.toFixed(2)}/month <span className="text-[10px] uppercase">{currency}</span>
                    </span>
                    <span>
                      ${monthlyTotal.toFixed(2)}/month{' '}
                      <span className="text-[10px] font-normal uppercase text-muted-foreground">{currency}</span>
                    </span>
                  </span>
                </p>
              </button>
            </div>

            <p className="mt-5 font-semibold text-foreground text-lg text-center">Unlock your full potential</p>
            <ul className="mt-6 grid grid-cols-2 gap-x-6 gap-y-6 pl-12">
              {FEATURES.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-2 text-foreground text-sm">
                  <Icon className="h-5 w-5 text-primary shrink-0" />
                  <span>{label}</span>
                </li>
              ))}
            </ul>

            <div className="mt-10 flex flex-col items-center gap-3">
              {checkoutError && (
                <p className="text-sm text-destructive text-center">{checkoutError}</p>
              )}
              <Button
                size="lg"
                onClick={handleCheckout}
                disabled={checkoutLoading}
                className="w-full bg-primary hover:bg-primary/90"
              >
                {checkoutLoading ? 'Redirecting…' : 'Continue to checkout'}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Recurring billing. Cancel anytime.
              </p>
            </div>

            <div className="mt-6 flex justify-center">
              <Button variant="outline" size="sm" onClick={handleSignOut} disabled={signingOut} className="gap-2">
                <LogOut className="h-4 w-4" />
                {signingOut ? 'Signing out…' : 'Sign out'}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
