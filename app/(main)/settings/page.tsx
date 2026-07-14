'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/lib/theme-provider';
import { useWorkspace } from '@/lib/workspace-context';
import { createClient } from '@/lib/supabase/client';
import { retryWithBackoff } from '@/lib/utils/retryWithBackoff';
import {
  Moon, 
  Sun, 
  User, 
  Mail, 
  Phone,
  CreditCard, 
  LogOut, 
  Shield,
  Globe,
  Plug,
  Flag,
  Layers,
  WalletCards,
  Clapperboard,
  Loader2,
  Save
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { PowerDialerSettingsCard } from '@/components/settings/PowerDialerSettingsCard';
import {
  SALESPERSON_STRIPE_GUARDIAN_POLICY,
  SALESPERSON_STRIPE_ONBOARDING_POLICY,
  SALESPERSON_STRIPE_PAYOUT_POLICY,
} from '@/app/lib/billing/salesperson-stripe-policy';
import type { User as SupabaseUser } from '@supabase/supabase-js';

interface EntitlementSnapshot {
  plan: string;
  is_active: boolean;
  source: string;
  current_period_end: string | null;
  upgrade_price_id?: string;
  isAmbassador?: boolean;
  planBadgeLabel?: string | null;
}

interface SalespersonSettingsState {
  id: string;
  full_name?: string | null;
  email?: string | null;
  status?: string | null;
  stripe_connect_account_id?: string | null;
  stripe_onboarding_completed?: boolean | null;
  stripe_details_submitted?: boolean | null;
  stripe_charges_enabled?: boolean | null;
  stripe_payouts_enabled?: boolean | null;
}

interface AccessStateSnapshot {
  isSalesperson?: boolean;
  accessLevel?: string | null;
  salesperson?: SalespersonSettingsState | null;
}

type SalespersonStripeStatusPayload = {
  accountId?: string | null;
  chargesEnabled?: boolean | null;
  payoutsEnabled?: boolean | null;
  detailsSubmitted?: boolean | null;
  onboardingUrl?: string | null;
  message?: string | null;
  error?: string;
};

type SalesEmailSettingsPayload = {
  salesperson?: {
    id: string | null;
    email: string | null;
    demoEmailHandle: string | null;
    demoEmailAddress: string | null;
    demoEmailReplyTo: string | null;
    demoEmailDomain: string;
    assignedPhoneNumber?: string | null;
    phoneForwardTo?: string | null;
    phoneNumberStatus?: string | null;
    phoneNumberAssignedAt?: string | null;
  } | null;
  error?: string;
};

const inFlightBillingWorkspaceIds = new Set<string>();

function SettingsPageContent() {
  const { theme, setTheme } = useTheme();
  const { currentWorkspaceId, membershipsByWorkspaceId } = useWorkspace();
  const router = useRouter();
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [entitlement, setEntitlement] = useState<EntitlementSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [entitlementError, setEntitlementError] = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [accessState, setAccessState] = useState<AccessStateSnapshot | null>(null);
  const [stripeConnectLoading, setStripeConnectLoading] = useState(false);
  const [stripeConnectError, setStripeConnectError] = useState<string | null>(null);
  const [stripeConnectNotice, setStripeConnectNotice] = useState<string | null>(null);
  const [salesEmailHandle, setSalesEmailHandle] = useState('');
  const [salesEmailForwardTo, setSalesEmailForwardTo] = useState('');
  const [salesEmailDomain, setSalesEmailDomain] = useState('wolfgrid.app');
  const [salesAssignedPhoneNumber, setSalesAssignedPhoneNumber] = useState('');
  const [salesPhoneForwardTo, setSalesPhoneForwardTo] = useState('');
  const [salesPhoneNumberStatus, setSalesPhoneNumberStatus] = useState('unassigned');
  const [salesEmailLoading, setSalesEmailLoading] = useState(false);
  const [salesEmailSaving, setSalesEmailSaving] = useState(false);
  const [salesEmailMessage, setSalesEmailMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [salesPhoneSaving, setSalesPhoneSaving] = useState(false);
  const [salesPhoneMessage, setSalesPhoneMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [movieMapControlsEnabled, setMovieMapControlsEnabled] = useState(false);
  const [movieMapControlsLoading, setMovieMapControlsLoading] = useState(false);
  const [movieMapControlsSaving, setMovieMapControlsSaving] = useState(false);
  const [movieMapControlsMessage, setMovieMapControlsMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const isSalespersonSettings =
    accessState?.isSalesperson === true || accessState?.accessLevel === 'salesperson';
  const salesperson = accessState?.salesperson ?? null;
  const currentWorkspaceRole = currentWorkspaceId ? membershipsByWorkspaceId[currentWorkspaceId] : null;
  const canManageWorkspaceSettings =
    currentWorkspaceRole === 'owner' || currentWorkspaceRole === 'admin';
  const canViewMasterListSettings =
    isSalespersonSettings || accessState?.accessLevel === 'founder';

  const applySalespersonStripeStatus = (payload: SalespersonStripeStatusPayload | null) => {
    if (!payload) return;
    setAccessState((current) => {
      if (!current?.salesperson) return current;
      return {
        ...current,
        salesperson: {
          ...current.salesperson,
          stripe_connect_account_id:
            payload.accountId !== undefined
              ? payload.accountId
              : current.salesperson.stripe_connect_account_id,
          stripe_details_submitted:
            payload.detailsSubmitted !== undefined
              ? payload.detailsSubmitted
              : current.salesperson.stripe_details_submitted,
          stripe_onboarding_completed:
            payload.detailsSubmitted !== undefined
              ? payload.detailsSubmitted
              : current.salesperson.stripe_onboarding_completed,
          stripe_charges_enabled:
            payload.chargesEnabled !== undefined
              ? payload.chargesEnabled
              : current.salesperson.stripe_charges_enabled,
          stripe_payouts_enabled:
            payload.payoutsEnabled !== undefined
              ? payload.payoutsEnabled
              : current.salesperson.stripe_payouts_enabled,
        },
      };
    });
  };

  useEffect(() => {
    const loadUserData = async () => {
      setLoadError(false);
      setEntitlementError(false);

      try {
        const supabase = createClient();

        // Get user
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (authUser) {
          setUser(authUser);

          // Get user profile
          const { data: userProfile } = await supabase
            .from('user_profiles')
            .select('pro_active, stripe_customer_id, weekly_door_goal, weekly_sessions_goal, weekly_minutes_goal')
            .eq('user_id', authUser.id)
            .single();

          if (userProfile) {
          } else {
            // Create profile if it doesn't exist
            const { data: newProfile } = await supabase
              .from('user_profiles')
              .insert({ user_id: authUser.id, pro_active: false })
              .select()
              .single();
            if (newProfile) {
              void newProfile;
            }
          }

          const stripeOnboardingStatus =
            typeof window !== 'undefined'
              ? new URLSearchParams(window.location.search).get('stripeOnboarding')
              : null;
          if (stripeOnboardingStatus === 'complete') {
            try {
              const response = await fetch('/api/salesperson/stripe-connect', {
                method: 'GET',
                credentials: 'include',
              });
              if (response.ok) {
                applySalespersonStripeStatus(await response.json());
              }
            } catch (error) {
              console.error('Error refreshing Stripe Connect status:', error);
            }
          }

          try {
            const accessRes = await fetch('/api/access/state', { credentials: 'include' });
            if (accessRes.ok) {
              setAccessState(await accessRes.json());
            } else {
              setAccessState(null);
            }
          } catch (error) {
            console.error('Error loading access state:', error);
            setAccessState(null);
          }

          try {
            const entitlementKey = authUser.id;
            if (!inFlightBillingWorkspaceIds.has(entitlementKey)) {
              inFlightBillingWorkspaceIds.add(entitlementKey);
              try {
                const entRes = await retryWithBackoff(async () => {
                  const response = await fetch('/api/billing/entitlement', { credentials: 'include' });
                  if (response.status >= 500) {
                    throw response;
                  }
                  return response;
                });
                if (entRes.ok) {
                  const entData = await entRes.json();
                  setEntitlement(entData);
                } else {
                  setEntitlement(null);
                  setEntitlementError(true);
                }
              } finally {
                inFlightBillingWorkspaceIds.delete(entitlementKey);
              }
            }
          } catch (error) {
            console.error('Error loading entitlement:', error);
            setEntitlement(null);
            setEntitlementError(true);
          }
        } else {
          router.push('/login');
        }
      } catch (error) {
        console.error('Error loading account settings:', error);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    };

    loadUserData();
  }, [router]);

  useEffect(() => {
    if (!isSalespersonSettings) return;

    let cancelled = false;
    const loadSalesEmailSettings = async () => {
      setSalesEmailLoading(true);
      setSalesEmailMessage(null);
      try {
        const qs = currentWorkspaceId ? `?workspaceId=${encodeURIComponent(currentWorkspaceId)}` : '';
        const response = await fetch(`/api/dialer/settings${qs}`, { credentials: 'include' });
        const data = (await response.json().catch(() => ({}))) as SalesEmailSettingsPayload;
        if (!response.ok) {
          throw new Error(data.error || 'Could not load sales email settings.');
        }
        if (cancelled) return;
        setSalesEmailHandle(data.salesperson?.demoEmailHandle ?? '');
        setSalesEmailForwardTo(data.salesperson?.demoEmailReplyTo ?? data.salesperson?.email ?? user?.email ?? '');
        setSalesEmailDomain(data.salesperson?.demoEmailDomain ?? 'wolfgrid.app');
        setSalesAssignedPhoneNumber(data.salesperson?.assignedPhoneNumber ?? '');
        setSalesPhoneForwardTo(data.salesperson?.phoneForwardTo ?? '');
        setSalesPhoneNumberStatus(data.salesperson?.phoneNumberStatus ?? 'unassigned');
      } catch (error) {
        if (!cancelled) {
          setSalesEmailMessage({
            type: 'error',
            text: error instanceof Error ? error.message : 'Could not load sales email settings.',
          });
        }
      } finally {
        if (!cancelled) setSalesEmailLoading(false);
      }
    };

    void loadSalesEmailSettings();
    return () => {
      cancelled = true;
    };
  }, [currentWorkspaceId, isSalespersonSettings, user?.email]);

  useEffect(() => {
    if (isSalespersonSettings || !currentWorkspaceId) {
      setMovieMapControlsEnabled(false);
      setMovieMapControlsLoading(false);
      setMovieMapControlsMessage(null);
      return;
    }

    let cancelled = false;
    setMovieMapControlsEnabled(false);
    setMovieMapControlsLoading(true);
    setMovieMapControlsMessage(null);

    fetch(`/api/workspace/map-settings?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, {
      credentials: 'include',
      cache: 'no-store',
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as {
          movieMapControlsEnabled?: boolean;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(data.error || 'Could not load map controls settings.');
        }
        return data;
      })
      .then((data) => {
        if (!cancelled) {
          setMovieMapControlsEnabled(data.movieMapControlsEnabled === true);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setMovieMapControlsEnabled(false);
          setMovieMapControlsMessage({
            type: 'error',
            text: error instanceof Error ? error.message : 'Could not load map controls settings.',
          });
        }
      })
      .finally(() => {
        if (!cancelled) setMovieMapControlsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [currentWorkspaceId, isSalespersonSettings]);

  const handleLogout = async () => {
    setLoggingOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  };

  const handleUpgrade = async () => {
    const priceId = entitlement?.upgrade_price_id;
    if (!priceId) {
      router.push('/billing');
      return;
    }
    setUpgradeLoading(true);
    try {
      const response = await fetch('/api/billing/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ priceId }),
      });
      const data = await response.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        router.push('/billing');
      }
    } catch (error) {
      console.error('Error creating checkout:', error);
      router.push('/billing');
    } finally {
      setUpgradeLoading(false);
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
        router.push('/billing');
      }
    } catch (error) {
      console.error('Error opening portal:', error);
      router.push('/billing');
    } finally {
      setPortalLoading(false);
    }
  };

  const handleSalespersonStripeConnect = async () => {
    setStripeConnectLoading(true);
    setStripeConnectError(null);
    setStripeConnectNotice(null);
    try {
      const response = await fetch('/api/salesperson/stripe-connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Could not create Stripe onboarding link.');
      }
      applySalespersonStripeStatus(data);
      if (typeof data.onboardingUrl === 'string' && data.onboardingUrl) {
        window.location.href = data.onboardingUrl;
        return;
      }
      setStripeConnectNotice(
        typeof data.message === 'string' && data.message
          ? data.message
          : 'Stripe payout status refreshed.'
      );
    } catch (error) {
      setStripeConnectError(
        error instanceof Error ? error.message : 'Could not create Stripe onboarding link.'
      );
    } finally {
      setStripeConnectLoading(false);
    }
  };

  const handleSaveSalesEmail = async () => {
    setSalesEmailSaving(true);
    setSalesEmailMessage(null);
    try {
      const response = await fetch('/api/dialer/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId ?? undefined,
          demoEmailHandle: salesEmailHandle.trim(),
          demoEmailReplyTo: salesEmailForwardTo.trim(),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as SalesEmailSettingsPayload;
      if (!response.ok) {
        throw new Error(data.error || 'Could not save sales email settings.');
      }

      setSalesEmailHandle(data.salesperson?.demoEmailHandle ?? '');
      setSalesEmailForwardTo(data.salesperson?.demoEmailReplyTo ?? data.salesperson?.email ?? user?.email ?? '');
      setSalesEmailDomain(data.salesperson?.demoEmailDomain ?? 'wolfgrid.app');
      setSalesEmailMessage({ type: 'success', text: 'Sales email saved.' });
    } catch (error) {
      setSalesEmailMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Could not save sales email settings.',
      });
    } finally {
      setSalesEmailSaving(false);
    }
  };

  const handleSaveSalesPhone = async () => {
    setSalesPhoneSaving(true);
    setSalesPhoneMessage(null);
    try {
      const response = await fetch('/api/dialer/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId ?? undefined,
          salesPhoneForwardTo: salesPhoneForwardTo.trim(),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as SalesEmailSettingsPayload;
      if (!response.ok) {
        throw new Error(data.error || 'Could not save sales phone forwarding.');
      }

      setSalesAssignedPhoneNumber(data.salesperson?.assignedPhoneNumber ?? '');
      setSalesPhoneForwardTo(data.salesperson?.phoneForwardTo ?? '');
      setSalesPhoneNumberStatus(data.salesperson?.phoneNumberStatus ?? 'unassigned');
      setSalesPhoneMessage({ type: 'success', text: 'Sales phone forwarding saved.' });
    } catch (error) {
      setSalesPhoneMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Could not save sales phone forwarding.',
      });
    } finally {
      setSalesPhoneSaving(false);
    }
  };

  const handleMovieMapControlsChange = async (checked: boolean) => {
    if (!currentWorkspaceId || !canManageWorkspaceSettings) return;

    const previousValue = movieMapControlsEnabled;
    setMovieMapControlsEnabled(checked);
    setMovieMapControlsSaving(true);
    setMovieMapControlsMessage(null);

    try {
      const response = await fetch('/api/workspace/map-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          movieMapControlsEnabled: checked,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        movieMapControlsEnabled?: boolean;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || 'Could not save map controls settings.');
      }

      setMovieMapControlsEnabled(data.movieMapControlsEnabled === true);
      setMovieMapControlsMessage({ type: 'success', text: 'Map controls setting saved.' });
    } catch (error) {
      setMovieMapControlsEnabled(previousValue);
      setMovieMapControlsMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Could not save map controls settings.',
      });
    } finally {
      setMovieMapControlsSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="text-gray-600 dark:text-foreground/80">Loading...</div>
        </div>
      </div>
    );
  }

  const salespersonPayoutsReady = salesperson?.stripe_payouts_enabled === true;
  const salespersonDetailsSubmitted = salesperson?.stripe_details_submitted === true;
  const salespersonStripeStarted = Boolean(salesperson?.stripe_connect_account_id);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">
      <header className="bg-white dark:bg-card border-b border-border sticky top-0 z-10">
        <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-2xl font-bold dark:text-white">Settings</h1>
        </div>
      </header>
      
      <main className="mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-8 py-6">
        <div className="space-y-6">
          {loadError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">
              Could not load account settings. Please refresh the page.
            </div>
          )}

          {/* Account Section */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <User className="w-5 h-5" />
                <CardTitle>Account</CardTitle>
              </div>
              <CardDescription>
                Manage your account information
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                  <Mail className="w-4 h-4" />
                  <span>Email</span>
                </div>
                <p className="text-base font-medium dark:text-white">{user?.email || 'N/A'}</p>
              </div>
              
              <div className="border-t border-gray-200 dark:border-gray-700" />
              
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                  <User className="w-4 h-4" />
                  <span>User ID</span>
                </div>
                <p className="text-xs font-mono text-gray-600 dark:text-gray-400 break-all">
                  {user?.id || 'N/A'}
                </p>
              </div>
            </CardContent>
          </Card>

          {isSalespersonSettings ? (
            <>
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <WalletCards className="w-5 h-5" />
                    <CardTitle>Stripe Connect</CardTitle>
                  </div>
                  <CardDescription>
                    Set up your payout account for WolfGrid sales commissions
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="text-base font-medium dark:text-white">Payout setup</p>
                        {salespersonPayoutsReady ? (
                          <Badge className="bg-green-500 hover:bg-green-600">Ready</Badge>
                        ) : salespersonDetailsSubmitted ? (
                          <Badge variant="outline">Submitted</Badge>
                        ) : salespersonStripeStarted ? (
                          <Badge variant="outline">In progress</Badge>
                        ) : (
                          <Badge variant="outline">Not connected</Badge>
                        )}
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {salespersonPayoutsReady
                          ? 'Stripe has confirmed your payout account is ready.'
                          : salespersonDetailsSubmitted
                            ? 'Stripe has your details. WolfGrid will wait for Stripe to enable payouts before commissions are paid.'
                            : salespersonStripeStarted
                              ? 'Continue Stripe onboarding to finish identity and bank details.'
                              : 'Connect Stripe so WolfGrid can pay your salesperson commissions.'}
                      </p>
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                        <div className="flex items-start gap-2">
                          <Shield className="mt-0.5 h-4 w-4 shrink-0" />
                          <div>
                            <p className="font-medium">{SALESPERSON_STRIPE_PAYOUT_POLICY}</p>
                            <p className="mt-1">
                              {SALESPERSON_STRIPE_ONBOARDING_POLICY}{' '}
                              {SALESPERSON_STRIPE_GUARDIAN_POLICY}
                            </p>
                          </div>
                        </div>
                      </div>
                      {stripeConnectError ? (
                        <p className="text-sm text-red-500">{stripeConnectError}</p>
                      ) : null}
                      {stripeConnectNotice ? (
                        <p className="text-sm text-gray-500 dark:text-gray-400">{stripeConnectNotice}</p>
                      ) : null}
                    </div>
                    <Button
                      variant={salespersonPayoutsReady ? 'outline' : 'default'}
                      size="sm"
                      onClick={handleSalespersonStripeConnect}
                      disabled={stripeConnectLoading}
                    >
                      <CreditCard className="w-4 h-4 mr-2" />
                      {stripeConnectLoading
                        ? 'Opening Stripe…'
                        : salespersonPayoutsReady
                          ? 'Update Stripe'
                          : salespersonDetailsSubmitted
                            ? 'Refresh status'
                          : salespersonStripeStarted
                            ? 'Continue setup'
                            : 'Set up payouts'}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Mail className="w-5 h-5" />
                    <CardTitle>Sales email</CardTitle>
                  </div>
                  <CardDescription>
                    Create your WolfGrid sender and choose where replies forward
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {salesEmailMessage ? (
                    <div
                      className={`rounded-lg border px-3 py-2 text-sm ${
                        salesEmailMessage.type === 'success'
                          ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400'
                          : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400'
                      }`}
                    >
                      {salesEmailMessage.text}
                    </div>
                  ) : null}

                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <div className="flex min-w-0 overflow-hidden rounded-md border border-input bg-background dark:bg-card">
                      <Input
                        value={salesEmailHandle}
                        onChange={(event) =>
                          setSalesEmailHandle(event.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))
                        }
                        disabled={salesEmailLoading || salesEmailSaving}
                        placeholder="firstname"
                        aria-label="Sales email handle"
                        className="h-10 min-w-0 border-0 focus-visible:ring-0"
                      />
                      <span className="flex h-10 shrink-0 items-center border-l border-input px-3 text-sm text-gray-500 dark:text-gray-400">
                        @{salesEmailDomain}
                      </span>
                    </div>
                    <Input
                      type="email"
                      inputMode="email"
                      value={salesEmailForwardTo}
                      onChange={(event) => setSalesEmailForwardTo(event.target.value)}
                      disabled={salesEmailLoading || salesEmailSaving}
                      placeholder="forward replies to"
                      aria-label="Forward replies to"
                      className="h-10"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleSaveSalesEmail()}
                      disabled={salesEmailLoading || salesEmailSaving || !salesEmailHandle.trim() || !salesEmailForwardTo.trim()}
                    >
                      {salesEmailSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                      Save email
                    </Button>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Sends demos from {salesEmailHandle || 'demo'}@{salesEmailDomain}, saves replies in WolfGrid Inbox, and forwards replies to {salesEmailForwardTo || 'your email'}.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Phone className="w-5 h-5" />
                    <CardTitle>Sales phone</CardTitle>
                  </div>
                  <CardDescription>
                    Forward calls from your WolfGrid sales number to your phone
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {salesPhoneMessage ? (
                    <div
                      className={`rounded-lg border px-3 py-2 text-sm ${
                        salesPhoneMessage.type === 'success'
                          ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400'
                          : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400'
                      }`}
                    >
                      {salesPhoneMessage.text}
                    </div>
                  ) : null}

                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <Input
                      value={salesAssignedPhoneNumber || 'No sales number assigned yet'}
                      disabled
                      aria-label="Assigned sales phone number"
                      className="h-10"
                    />
                    <Input
                      type="tel"
                      inputMode="tel"
                      value={salesPhoneForwardTo}
                      onChange={(event) => setSalesPhoneForwardTo(event.target.value)}
                      disabled={salesEmailLoading || salesPhoneSaving}
                      placeholder="forward calls to"
                      aria-label="Forward calls to"
                      className="h-10"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleSaveSalesPhone()}
                      disabled={salesEmailLoading || salesPhoneSaving}
                    >
                      {salesPhoneSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                      Save phone
                    </Button>
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Status: {salesPhoneNumberStatus}. Incoming calls to {salesAssignedPhoneNumber || 'your assigned WolfGrid number'} forward to {salesPhoneForwardTo || 'your phone once saved'}.
                  </p>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CreditCard className="w-5 h-5" />
                  <CardTitle>Subscription</CardTitle>
                </div>
                <CardDescription>
                  Manage your subscription and billing
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="text-base font-medium dark:text-white">Plan</p>
                      {entitlementError ? (
                        <Badge variant="outline">Unavailable</Badge>
                      ) : entitlement?.isAmbassador ? (
                        <Badge className="bg-red-500 hover:bg-red-600">AMBASSADOR</Badge>
                      ) : entitlement?.is_active && (entitlement.plan === 'pro' || entitlement.plan === 'team') ? (
                        <Badge className="bg-green-500 hover:bg-green-600">Pro</Badge>
                      ) : (
                        <Badge variant="outline">Free</Badge>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {entitlementError
                        ? 'Could not load plan details.'
                        : entitlement?.isAmbassador
                        ? 'You have Pro-level access through the WolfGrid Ambassador Program.'
                        : entitlement?.is_active
                        ? 'You have access to all Pro features'
                        : 'Upgrade to Pro for unlimited QR codes and advanced features'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {!entitlementError && !entitlement?.is_active && !entitlement?.isAmbassador && (
                      <Button onClick={handleUpgrade} size="sm" disabled={upgradeLoading}>
                        {upgradeLoading ? 'Redirecting…' : 'Upgrade to Pro'}
                      </Button>
                    )}
                    {!entitlement?.isAmbassador && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleManageBilling}
                        disabled={portalLoading}
                      >
                        {portalLoading ? 'Opening…' : 'Manage billing'}
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {!isSalespersonSettings ? (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Clapperboard className="w-5 h-5" />
                  <CardTitle>Map demo controls</CardTitle>
                </div>
                <CardDescription>
                  Show cinematic clapperboard controls and the assignment map Run demo button.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {movieMapControlsMessage ? (
                  <div
                    className={`rounded-lg border px-3 py-2 text-sm ${
                      movieMapControlsMessage.type === 'success'
                        ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400'
                        : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400'
                    }`}
                  >
                    {movieMapControlsMessage.text}
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-base font-medium dark:text-white mb-1">Demo controls</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Show cinematic clapperboard controls and the assignment map Run demo button.
                    </p>
                  </div>
                  <Switch
                    id="movie-map-controls"
                    checked={movieMapControlsEnabled}
                    disabled={
                      movieMapControlsLoading ||
                      movieMapControlsSaving ||
                      !currentWorkspaceId ||
                      !canManageWorkspaceSettings
                    }
                    onCheckedChange={(checked) => void handleMovieMapControlsChange(checked)}
                    aria-label="Movie controls"
                  />
                </div>
              </CardContent>
            </Card>
          ) : null}

          {isSalespersonSettings ? <PowerDialerSettingsCard mode="salesperson" /> : null}

          {canViewMasterListSettings ? (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Layers className="w-5 h-5" />
                  <CardTitle>Master lead list</CardTitle>
                </div>
                <CardDescription>
                  View every shared lead row and filter assignments by member.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-base font-medium dark:text-white mb-1">Workspace master list</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Review assigned companies, call states, lists, and member ownership in one place.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => router.push('/settings/master-list')}
                  >
                    <Layers className="w-4 h-4 mr-2" />
                    Open
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {!isSalespersonSettings ? (
            <>
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Plug className="w-5 h-5" />
                    <CardTitle>Integrations</CardTitle>
                  </div>
                  <CardDescription>
                    Connect your CRM and other tools
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-base font-medium dark:text-white mb-1">CRM Connections</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Sync leads to Follow Up Boss and other CRMs
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => router.push('/settings/integrations')}
                    >
                      <Plug className="w-4 h-4 mr-2" />
                      Manage
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Flag className="w-5 h-5" />
                    <CardTitle>Challenges</CardTitle>
                  </div>
                  <CardDescription>
                    View active global and team challenges from Settings
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-base font-medium dark:text-white mb-1">Challenge center</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Track progress, review upcoming challenges, and check completed runs.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => router.push('/settings/challenges')}
                    >
                      <Flag className="w-4 h-4 mr-2" />
                      Open Challenges
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : null}

          {/* Appearance Section */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Sun className="w-5 h-5" />
                <CardTitle>Appearance</CardTitle>
              </div>
              <CardDescription>
                Customize the look and feel of the app
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-base font-medium dark:text-white mb-1">Theme</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Choose between light and dark mode
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant={theme === 'light' ? 'default' : 'outline'}
                    onClick={() => setTheme('light')}
                    size="sm"
                    className="flex items-center gap-2"
                  >
                    <Sun className="w-4 h-4" />
                    Light
                  </Button>
                  <Button
                    variant={theme === 'dark' ? 'default' : 'outline'}
                    onClick={() => setTheme('dark')}
                    size="sm"
                    className="flex items-center gap-2"
                  >
                    <Moon className="w-4 h-4" />
                    Dark
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Privacy & Security Section */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5" />
                <CardTitle>Privacy & Security</CardTitle>
              </div>
              <CardDescription>
                Manage your privacy and security settings
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-base font-medium dark:text-white mb-1">Data Privacy</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Your data is encrypted and secure
                    </p>
                  </div>
                </div>
                <div className="border-t border-gray-200 dark:border-gray-700" />
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-base font-medium dark:text-white mb-1">Terms & Privacy</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Review our terms of service and privacy policy
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => router.push('/privacy')}
                  >
                    <Globe className="w-4 h-4 mr-2" />
                    View
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Danger Zone */}
          <Card className="border-red-200 dark:border-red-900">
            <CardHeader>
              <CardTitle className="text-red-600 dark:text-red-400">Danger Zone</CardTitle>
              <CardDescription>
                Irreversible and destructive actions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="destructive"
                onClick={handleLogout}
                disabled={loggingOut}
                className="w-full sm:w-auto"
              >
                <LogOut className="w-4 h-4 mr-2" />
                {loggingOut ? 'Signing out...' : 'Sign Out'}
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

export default function SettingsPage() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-gray-600 dark:text-gray-400">Loading...</div>
        </div>
      </div>
    );
  }

  return <SettingsPageContent />;
}
