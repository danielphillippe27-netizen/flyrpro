'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CreditCard, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type Plan = 'free' | 'pro' | 'team';
type Source = 'none' | 'stripe' | 'apple';

interface EntitlementState {
  plan: Plan;
  is_active: boolean;
  source: Source;
  current_period_end: string | null;
  upgrade_price_id?: string;
}

export default function BillingPage() {
  const router = useRouter();
  const [entitlement, setEntitlement] = useState<EntitlementState | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  useEffect(() => {
    const fetchEntitlement = async () => {
      try {
        const res = await fetch('/api/billing/entitlement', { credentials: 'include' });
        if (res.status === 401) {
          router.push('/login');
          return;
        }
        if (res.ok) {
          const data = await res.json();
          setEntitlement(data);
        }
      } finally {
        setLoading(false);
      }
    };
    fetchEntitlement();
  }, [router]);

  const handleUpgrade = async () => {
    const priceId = entitlement?.upgrade_price_id;
    if (!priceId) {
      setCheckoutError('Upgrade is not configured. Please try again later.');
      return;
    }
    setCheckoutError(null);
    setCheckoutLoading(true);
    try {
      const res = await fetch('/api/billing/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ priceId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        window.location.href = data.url;
        return;
      }
      const message =
        data?.error ||
        (res.status === 401 ? 'Please sign in again.' : res.status === 400 ? 'Invalid plan configuration.' : 'Failed to start checkout.');
      setCheckoutError(message);
    } catch (e) {
      console.error(e);
      setCheckoutError('Network error. Please try again.');
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleManageBilling = async () => {
    setPortalLoading(true);
    try {
      const res = await fetch('/api/billing/stripe/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Failed to open billing portal');
      }
    } catch (e) {
      console.error(e);
      alert('Failed to open billing portal');
    } finally {
      setPortalLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center gap-4 mb-6">
        <Link
          href="/settings"
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Settings
        </Link>
        <Link
          href="/pricing"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          View all plans
        </Link>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CreditCard className="w-5 h-5" />
            <CardTitle>Billing</CardTitle>
          </div>
          <CardDescription>
            Your current plan and subscription. Manage payment methods and billing from the portal.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <p className="text-base font-medium">Plan</p>
                {entitlement?.is_active && (entitlement.plan === 'pro' || entitlement.plan === 'team') ? (
                  <Badge className="bg-green-500 hover:bg-green-600">Pro</Badge>
                ) : (
                  <Badge variant="outline">Free</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {entitlement?.is_active
                  ? 'You have access to Pro features.'
                  : 'Upgrade to Pro for more features.'}
              </p>
              {entitlement?.current_period_end && (
                <p className="text-xs text-muted-foreground">
                  Current period ends: {new Date(entitlement.current_period_end).toLocaleDateString()}
                </p>
              )}
            </div>
          </div>

          {checkoutError && (
            <p className="text-sm text-red-500" role="alert">
              {checkoutError}
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            {(!entitlement?.is_active || entitlement.plan === 'free') && entitlement?.upgrade_price_id && (
              <Button onClick={handleUpgrade} disabled={checkoutLoading}>
                {checkoutLoading ? 'Redirecting…' : 'Upgrade to Pro'}
              </Button>
            )}
            {entitlement?.source === 'stripe' && (
              <Button variant="outline" onClick={handleManageBilling} disabled={portalLoading}>
                {portalLoading ? 'Opening…' : 'Manage billing'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
