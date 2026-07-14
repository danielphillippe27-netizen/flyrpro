'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CreditCard, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

type Plan = 'free' | 'pro' | 'team' | 'ambassador';
type Source = 'none' | 'stripe' | 'apple';

interface EntitlementState {
  plan: Plan;
  is_active: boolean;
  source: Source;
  current_period_end: string | null;
  upgrade_price_id?: string;
  dialer_offer?: {
    price_id?: string | null;
    amount: string;
    currency: 'USD' | 'CAD';
    period: string;
  };
  dialer_addon?: {
    status: 'inactive' | 'active' | 'past_due' | 'canceled';
    is_active: boolean;
    price_id?: string | null;
    amount_cents?: number | null;
    currency?: string | null;
  };
  dialer_number?: string | null;
  dialer_number_status?: 'unassigned' | 'active' | 'released' | null;
  dialer_uses_shared_default?: boolean;
  isAmbassador?: boolean;
  planBadgeLabel?: string | null;
}

export default function BillingPage() {
  const router = useRouter();
  const [entitlement, setEntitlement] = useState<EntitlementState | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [dialerLoading, setDialerLoading] = useState(false);
  const [dialerError, setDialerError] = useState<string | null>(null);
  const dialerOffer = entitlement?.dialer_offer;
  const dialerOfferLabel = dialerOffer
    ? `${dialerOffer.currency === 'CAD' ? 'CA$' : '$'}${dialerOffer.amount}${dialerOffer.currency === 'USD' ? ' USD' : ''}${dialerOffer.period}`
    : 'CA$19.99/month';

  const loadEntitlement = useCallback(async () => {
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
  }, [router]);

  useEffect(() => {
    loadEntitlement();
  }, [loadEntitlement]);

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

  const handleEnableDialerAddon = async () => {
    setDialerLoading(true);
    setDialerError(null);
    try {
      const res = await fetch('/api/billing/stripe/dialer-addon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDialerError(data?.error || 'Failed to enable the Power Dialer add-on.');
        return;
      }
      await loadEntitlement();
    } catch (error) {
      console.error(error);
      setDialerError('Network error. Please try again.');
    } finally {
      setDialerLoading(false);
    }
  };

  const handleDisableDialerAddon = async () => {
    setDialerLoading(true);
    setDialerError(null);
    try {
      const res = await fetch('/api/billing/stripe/dialer-addon', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDialerError(data?.error || 'Failed to remove the Power Dialer add-on.');
        return;
      }
      await loadEntitlement();
    } catch (error) {
      console.error(error);
      setDialerError('Network error. Please try again.');
    } finally {
      setDialerLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <p className="text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
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
                {entitlement?.isAmbassador ? (
                  <Badge className="bg-red-500 hover:bg-red-600">AMBASSADOR</Badge>
                ) : entitlement?.is_active && (entitlement.plan === 'pro' || entitlement.plan === 'team') ? (
                  <Badge className="bg-green-500 hover:bg-green-600">Pro</Badge>
                ) : (
                  <Badge variant="outline">Free</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {entitlement?.isAmbassador
                  ? 'You have Pro-level access through the WolfGrid Ambassador Program.'
                  : entitlement?.is_active
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
            {!entitlement?.isAmbassador && (!entitlement?.is_active || entitlement.plan === 'free') && entitlement?.upgrade_price_id && (
              <Button onClick={handleUpgrade} disabled={checkoutLoading}>
                {checkoutLoading ? 'Redirecting…' : 'Upgrade to Pro'}
              </Button>
            )}
            {!entitlement?.isAmbassador && (!entitlement?.is_active || entitlement.plan === 'free') && !entitlement?.upgrade_price_id && (
              <Button asChild>
                <Link href="/pricing">Choose a plan</Link>
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

      <Card className="mt-6">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Power Dialer Add-On</CardTitle>
              <CardDescription>
                Workspace add-on for the power dialer with a dedicated caller ID path.
              </CardDescription>
            </div>
            {entitlement?.dialer_addon?.is_active ? (
              <Badge className="bg-green-500 hover:bg-green-600">Active</Badge>
            ) : (
              <Badge variant="outline">Inactive</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {dialerOfferLabel} per workspace. This turns on dialer billing and gives the workspace its own dialer number instead of falling back to a shared default caller ID.
          </p>
          <div className="space-y-1 text-sm">
            <p>
              Status:{' '}
              <span className="font-medium capitalize">
                {entitlement?.dialer_addon?.status ?? 'inactive'}
              </span>
            </p>
            <p>
              Workspace number:{' '}
              <span className="font-medium">
                {entitlement?.dialer_number ?? 'Not assigned yet'}
              </span>
            </p>
            {entitlement?.dialer_uses_shared_default && (
              <p className="text-amber-600">
                The workspace is still on the shared deployment default caller ID until a dedicated number is assigned.
              </p>
            )}
          </div>

          {dialerError && (
            <p className="text-sm text-red-500" role="alert">
              {dialerError}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {entitlement?.dialer_addon?.is_active ? (
              <>
                <Button variant="outline" onClick={handleDisableDialerAddon} disabled={dialerLoading}>
                  {dialerLoading ? 'Updating…' : 'Remove dialer add-on'}
                </Button>
                <Button asChild>
                  <Link href="/settings/integrations">Manage dialer setup</Link>
                </Button>
              </>
            ) : (
              <Button
                onClick={handleEnableDialerAddon}
                disabled={dialerLoading || !entitlement?.is_active}
              >
                {dialerLoading ? 'Updating…' : `Enable dialer add-on (${dialerOfferLabel})`}
              </Button>
            )}
          </div>

          {!entitlement?.is_active && (
            <p className="text-xs text-muted-foreground">
              A paid workspace subscription is required before the dialer add-on can be enabled.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
