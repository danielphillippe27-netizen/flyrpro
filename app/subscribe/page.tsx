'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { AlertCircle, LogOut, Monitor, Flag, QrCode, Link, Calendar, RefreshCw, Map, MoreHorizontal } from 'lucide-react';
import { getClientAsync } from '@/lib/supabase/client';

type AccessState = {
  role: string | null;
  workspaceName: string | null;
  maxSeats?: number;
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

function SubscribeContent() {

  const router = useRouter();
  const searchParams = useSearchParams();
  const reason = searchParams.get('reason');
  const [state, setState] = useState<AccessState | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [plan, setPlan] = useState<'annual' | 'monthly'>('annual');
  const [currency, setCurrency] = useState<'USD' | 'CAD'>('CAD');
  const seats = Math.max(1, state?.maxSeats ?? 1);

  const annualBase = currency === 'CAD' ? 399 : 299;
  const annualMonthlyEquivalent = annualBase / 12;
  const annualTotal = annualBase * seats;
  const monthlyPrice = currency === 'CAD' ? 39.99 : 29.99;
  const monthlyTotal = monthlyPrice * seats;
  const cadMonthlyList = 50 * seats;

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
    const run = async () => {
      try {
        const res = await fetch('/api/access/state', { credentials: 'include' });
        if (res.status === 401) {
          router.replace('/login');
          return;
        }
        if (res.ok && mounted) {
          const data = await res.json();
          setState(data);
          if (data.hasAccess) {
            router.replace('/home');
            return;
          }
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };
    run();
    return () => {
      mounted = false;
    };
  }, [router]);

  const handleStartTrial = async () => {
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
    } catch (e) {
      setCheckoutError('Network error. Please try again.');
    } finally {
      setCheckoutLoading(false);
    }
  };

  if (loading || !state) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (state.hasAccess) {
    return null;
  }

  const isMemberInactive =
    reason === 'member-inactive' ||
    state.reason === 'member-inactive' ||
    (state.role !== 'owner' && !state.hasAccess);

  if (isMemberInactive) {
    return (
      <div className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-4 rounded-2xl border border-border bg-card/95 dark:bg-zinc-900/95 p-8 shadow-2xl">
          <div className="flex justify-center">
            <AlertCircle className="h-12 w-12 text-amber-500" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">
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
      </div>
    );
  }

  return (
    <div className="dark min-h-screen bg-gradient-to-br from-black to-[#262626] flex flex-col items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-red-950/40 via-transparent to-black/80 pointer-events-none" />
      <div className="relative w-full max-w-xl rounded-2xl border border-zinc-700/50 bg-[#242424] p-8 shadow-2xl space-y-0">
        <div className="text-center space-y-3">
          <h1 className="text-5xl font-bold text-white">
            Track your outreach.
          </h1>
          <p className="text-[#AAAAAA] text-xl">
            Your business will reward you.
          </p>
        </div>

        <p className="mt-6 text-center">
          <button
            type="button"
            onClick={() => setCurrency((c) => (c === 'USD' ? 'CAD' : 'USD'))}
            className="text-sm text-[#AAAAAA] hover:text-white underline underline-offset-2"
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
                ? 'border-red-500 bg-red-500/10'
                : 'border-zinc-600 bg-[#2a2a2a] hover:border-zinc-500'
            }`}
          >
            <div>
              <p className="font-semibold text-white">Annual</p>
              <p className="text-xs text-[#AAAAAA]">
                Billed at ${annualTotal.toFixed(2)}/year for {seats} seat{seats === 1 ? '' : 's'}
                <span className="ml-1 text-[10px] uppercase text-[#888]">{currency}</span>
              </p>
            </div>
            <p className="font-semibold text-white text-right">
              ~${(annualMonthlyEquivalent * seats).toFixed(2)}/month
              <span className="ml-1 text-[10px] font-normal uppercase text-[#888]">{currency}</span>
            </p>
          </button>
          <button
            type="button"
            onClick={() => setPlan('monthly')}
            className={`w-full flex items-center justify-between rounded-xl border-2 px-4 py-3 text-left transition-colors ${
              plan === 'monthly'
                ? 'border-red-500 bg-red-500/10'
                : 'border-zinc-600 bg-[#2a2a2a] hover:border-zinc-500'
            }`}
          >
            <div>
              <p className="font-semibold text-white">Monthly</p>
              <p className="text-xs text-[#AAAAAA]">
                {seats} seat{seats === 1 ? '' : 's'}
              </p>
              {currency === 'CAD' && (
                <p className="text-xs text-[#AAAAAA]">Limited-time offer</p>
              )}
            </div>
            <p className="font-semibold text-white text-right">
              {currency === 'CAD' ? (
                <span className="flex flex-col items-end">
                  <span className="line-through text-[#888] text-sm font-normal">
                    ${cadMonthlyList.toFixed(2)}/month <span className="text-[10px] uppercase">CAD</span>
                  </span>
                  <span>
                    ${monthlyTotal.toFixed(2)}/month{' '}
                    <span className="text-[10px] font-normal uppercase text-[#888]">CAD</span>
                  </span>
                </span>
              ) : (
                <span>
                  ${monthlyTotal.toFixed(2)}/month{' '}
                  <span className="ml-1 text-[10px] font-normal uppercase text-[#888]">USD</span>
                </span>
              )}
            </p>
          </button>
        </div>

        <p className="mt-5 font-semibold text-white text-lg text-center">Unlock your full potential</p>
        <ul className="mt-6 grid grid-cols-2 gap-x-6 gap-y-6 pl-12">
          {FEATURES.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-2 text-white text-sm">
              <Icon className="h-5 w-5 text-red-500 shrink-0" />
              <span>{label}</span>
            </li>
          ))}
        </ul>

        <div className="mt-10 flex flex-col items-center gap-3">
          {checkoutError && (
            <p className="text-sm text-red-400 text-center">{checkoutError}</p>
          )}
          <Button
            size="lg"
            onClick={handleStartTrial}
            disabled={checkoutLoading}
            className="w-full bg-[#ef4444] text-white hover:bg-[#dc2626] border-0"
          >
            {checkoutLoading ? 'Redirecting…' : 'Start trial'}
          </Button>
          <p className="text-xs text-[#AAAAAA] text-center">
            Recurring billing. Cancel anytime.
          </p>
        </div>

        <div className="mt-6 flex justify-center">
          <Button variant="outline" size="sm" onClick={handleSignOut} disabled={signingOut} className="gap-2 border-zinc-600 text-white hover:bg-zinc-800 hover:text-white">
            <LogOut className="h-4 w-4" />
            {signingOut ? 'Signing out…' : 'Sign out'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function SubscribePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 dark:bg-background flex items-center justify-center">
          <p className="text-muted-foreground">Loading…</p>
        </div>
      }
    >
      <SubscribeContent />
    </Suspense>
  );
}
