'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { AlertCircle, LogOut, Monitor, Flag, QrCode, Link, Calendar, RefreshCw, Map, Gauge, MoreHorizontal } from 'lucide-react';
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
  { icon: Gauge, label: 'Performance reports' },
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
  const planButtonBaseClass =
    'group relative w-full overflow-hidden rounded-2xl border px-5 py-4 text-left backdrop-blur-xl transition-all duration-200';

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
    let redirectTimer: ReturnType<typeof setTimeout> | null = null;
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
            // Brief delay so post-onboarding workspace update is visible to the gate when /home loads
            redirectTimer = setTimeout(() => {
              if (mounted) router.replace('/home');
            }, 600);
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
      if (redirectTimer) clearTimeout(redirectTimer);
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
      <div className="dark min-h-screen bg-gradient-to-br from-black via-zinc-950 to-[#262626] flex items-center justify-center">
        <p className="text-[#AAAAAA]">Loading…</p>
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
      <div className="dark min-h-screen bg-gradient-to-br from-black via-zinc-950 to-[#262626] flex flex-col items-center justify-center p-6 relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute inset-0 scale-110 bg-cover bg-center opacity-35"
            style={{ backgroundImage: "url('/WEIRFF_1-06d620b4-4558-472d-90f5-da6be22c2dd1.png')" }}
          />
        </div>
        <div className="absolute inset-0 bg-gradient-to-b from-red-950/35 via-transparent to-black/80 pointer-events-none" />
        <div className="relative max-w-md w-full text-center space-y-4 rounded-2xl border border-white/12 bg-black/72 p-8 backdrop-blur-2xl shadow-[0_28px_80px_rgba(0,0,0,0.72),0_12px_34px_rgba(0,0,0,0.58),inset_0_1px_0_rgba(255,255,255,0.14)]">
          <div className="flex justify-center">
            <AlertCircle className="h-12 w-12 text-amber-500" />
          </div>
          <h1 className="text-xl font-semibold text-white">
            Workspace subscription inactive
          </h1>
          <p className="text-[#AAAAAA] text-sm">
            {state.workspaceName
              ? `${state.workspaceName} does not have an active subscription.`
              : 'This workspace does not have an active subscription.'}{' '}
            Contact your workspace owner to renew so you can access the dashboard.
          </p>
          <div className="flex justify-center pt-2">
            <Button
              variant="outline"
              onClick={handleSignOut}
              disabled={signingOut}
              className="gap-2 border-white/15 bg-white/[0.03] text-white hover:bg-white/[0.08] hover:text-white"
            >
              <LogOut className="h-4 w-4" />
              {signingOut ? 'Signing out…' : 'Sign out'}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dark min-h-screen bg-gradient-to-br from-black via-zinc-950 to-[#262626] flex flex-col items-center justify-center p-4 sm:p-6 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0 scale-110 bg-cover bg-center opacity-35"
          style={{ backgroundImage: "url('/WEIRFF_1-06d620b4-4558-472d-90f5-da6be22c2dd1.png')" }}
        />
      </div>
      <div className="absolute inset-0 bg-gradient-to-b from-red-950/35 via-transparent to-black/80 pointer-events-none" />
      <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-red-500/20 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 right-[-6rem] h-64 w-64 rounded-full bg-white/10 blur-3xl" />

      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-white/12 bg-black/72 p-8 backdrop-blur-2xl shadow-[0_28px_80px_rgba(0,0,0,0.72),0_12px_34px_rgba(0,0,0,0.58),inset_0_1px_0_rgba(255,255,255,0.14)] space-y-0">
        <div className="pointer-events-none absolute -top-28 left-1/2 h-56 w-[140%] -translate-x-1/2 rounded-full bg-white/8 blur-3xl" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/35" />
        <div className="pointer-events-none absolute -right-14 bottom-16 h-36 w-36 rounded-full bg-red-400/20 blur-3xl" />

        <div className="relative z-10 text-center space-y-3">
          <h1 className="text-5xl font-bold text-white">
            Track your outreach.
          </h1>
          <p className="text-[#AAAAAA] text-xl">
            Your business will reward you.
          </p>
        </div>

        <p className="relative z-10 mt-6 text-center">
          <button
            type="button"
            onClick={() => setCurrency((c) => (c === 'USD' ? 'CAD' : 'USD'))}
            className="text-sm text-[#B2B2B2] hover:text-white underline underline-offset-2 transition-colors"
          >
            {currency === 'USD' ? 'Show prices in CAD' : 'Show prices in USD'}
          </button>
        </p>

        <div className="relative z-10 mt-6 space-y-2.5">
          <button
            type="button"
            onClick={() => setPlan('annual')}
            className={`${planButtonBaseClass} ${
              plan === 'annual'
                ? 'border-red-400/80 bg-[linear-gradient(135deg,rgba(239,68,68,0.24),rgba(0,0,0,0.55))] shadow-[0_12px_30px_rgba(239,68,68,0.18),inset_0_1px_0_rgba(255,255,255,0.24)]'
                : 'border-white/20 bg-black/40 hover:border-white/30 hover:bg-black/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
            }`}
          >
            <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/40 opacity-90" />
            <div className="relative z-10">
              <p className="font-semibold text-white">Annual</p>
              <p className="text-xs text-[#B2B2B2]">
                Billed at ${annualTotal.toFixed(2)}/year for {seats} seat{seats === 1 ? '' : 's'}
              </p>
            </div>
            <p className="relative z-10 font-semibold text-white text-right">
              ${(annualMonthlyEquivalent * seats).toFixed(2)}/month
            </p>
          </button>
          <button
            type="button"
            onClick={() => setPlan('monthly')}
            className={`${planButtonBaseClass} ${
              plan === 'monthly'
                ? 'border-red-400/80 bg-[linear-gradient(135deg,rgba(239,68,68,0.24),rgba(0,0,0,0.55))] shadow-[0_12px_30px_rgba(239,68,68,0.18),inset_0_1px_0_rgba(255,255,255,0.24)]'
                : 'border-white/20 bg-black/40 hover:border-white/30 hover:bg-black/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
            }`}
          >
            <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/40 opacity-90" />
            <div className="relative z-10">
              <p className="font-semibold text-white">Monthly</p>
              <p className="text-xs text-[#B2B2B2]">
                Billed at ${monthlyTotal.toFixed(2)}/month for {seats} seat{seats === 1 ? '' : 's'}
              </p>
            </div>
            <p className="relative z-10 font-semibold text-white text-right">
              ${monthlyTotal.toFixed(2)}/month
            </p>
          </button>
        </div>

        <p className="relative z-10 mt-5 font-semibold text-white text-lg text-center">Unlock your full potential</p>
        <ul className="relative z-10 mt-6 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-5 sm:pl-10">
          {FEATURES.map(({ icon: Icon, label }) => {
            const isDesktopDashboard = label === 'Desktop Dashboard';
            return (
              <li
                key={label}
                className={`flex items-center gap-2.5 text-white text-sm ${
                  isDesktopDashboard
                    ? 'sm:col-span-2 rounded-xl border border-red-400/60 bg-red-500/12 px-3.5 py-2.5 shadow-[0_10px_28px_rgba(239,68,68,0.2),inset_0_1px_0_rgba(255,255,255,0.2)]'
                    : ''
                }`}
              >
                <Icon
                  className={`text-red-500 shrink-0 ${
                    isDesktopDashboard ? 'h-6 w-6' : 'h-5 w-5'
                  }`}
                />
                <span className={isDesktopDashboard ? 'text-base font-semibold' : ''}>
                  {label}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="relative z-10 mt-10 flex flex-col items-center gap-3">
          {checkoutError && (
            <p className="text-sm text-red-400 text-center">{checkoutError}</p>
          )}
          <Button
            size="lg"
            onClick={handleStartTrial}
            disabled={checkoutLoading}
            className="w-full bg-[#ef4444] text-white hover:bg-[#dc2626] border-0"
          >
            {checkoutLoading ? 'Redirecting…' : 'Continue to checkout'}
          </Button>
          <p className="text-xs text-[#AAAAAA] text-center">
            Recurring billing. Cancel anytime.
          </p>
        </div>

        <div className="relative z-10 mt-6 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSignOut}
            disabled={signingOut}
            className="gap-2 border-white/15 bg-white/[0.03] text-white hover:bg-white/[0.08] hover:text-white"
          >
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
