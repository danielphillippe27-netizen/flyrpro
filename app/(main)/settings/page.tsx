'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from '@/lib/theme-provider';
import { createClient } from '@/lib/supabase/client';
import {
  Moon, 
  Sun, 
  User, 
  Mail, 
  CreditCard, 
  LogOut, 
  Shield,
  Bell,
  Globe,
  Plug
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface UserProfile {
  pro_active: boolean;
  stripe_customer_id: string | null;
}

interface EntitlementSnapshot {
  plan: string;
  is_active: boolean;
  source: string;
  current_period_end: string | null;
  upgrade_price_id?: string;
}

function SettingsPageContent() {
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [entitlement, setEntitlement] = useState<EntitlementSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    const loadUserData = async () => {
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
          setProfile(userProfile);
        } else {
          // Create profile if it doesn't exist
          const { data: newProfile } = await supabase
            .from('user_profiles')
            .insert({ user_id: authUser.id, pro_active: false })
            .select()
            .single();
          if (newProfile) {
            setProfile(newProfile);
          }
        }
        const entRes = await fetch('/api/billing/entitlement', { credentials: 'include' });
        if (entRes.ok) {
          const entData = await entRes.json();
          setEntitlement(entData);
        }
      } else {
        router.push('/login');
      }
      
      setLoading(false);
    };

    loadUserData();
  }, [router]);

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

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="text-gray-600 dark:text-foreground/80">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">
      <header className="bg-white dark:bg-card border-b border-border sticky top-0 z-10">
        <div className="mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-2xl font-bold dark:text-white">Settings</h1>
        </div>
      </header>
      
      <main className="mx-auto w-full max-w-4xl px-4 sm:px-6 lg:px-8 py-6">
        <div className="space-y-6">
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

          {/* Subscription Section — source of truth: entitlements */}
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
                    {entitlement?.is_active && (entitlement.plan === 'pro' || entitlement.plan === 'team') ? (
                      <Badge className="bg-green-500 hover:bg-green-600">Pro</Badge>
                    ) : (
                      <Badge variant="outline">Free</Badge>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {entitlement?.is_active
                      ? 'You have access to all Pro features'
                      : 'Upgrade to Pro for unlimited QR codes and advanced features'}
                  </p>
                </div>
                <div className="flex gap-2">
                  {!entitlement?.is_active && (
                    <Button onClick={handleUpgrade} size="sm" disabled={upgradeLoading}>
                      {upgradeLoading ? 'Redirecting…' : 'Upgrade to Pro'}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleManageBilling}
                    disabled={portalLoading}
                  >
                    {portalLoading ? 'Opening…' : 'Manage billing'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Integrations Section */}
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
