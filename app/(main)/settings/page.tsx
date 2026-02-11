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

function BowArrowIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Bow */}
      <path d="M5 20 Q12 2 19 20" />
      {/* Arrow shaft + head */}
      <path d="M6 12h11l2-2v4l-2-2" />
    </svg>
  );
}
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface UserProfile {
  pro_active: boolean;
  stripe_customer_id: string | null;
}

function SettingsPageContent() {
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);
  const [goals, setGoals] = useState<{ weekly_door_goal: number; weekly_sessions_goal: number | null; weekly_minutes_goal: number | null } | null>(null);
  const [goalsSaving, setGoalsSaving] = useState(false);
  const [goalsDoor, setGoalsDoor] = useState('');
  const [goalsSessions, setGoalsSessions] = useState('');
  const [goalsMinutes, setGoalsMinutes] = useState('');

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
      } else {
        router.push('/login');
      }
      
      setLoading(false);
    };

    loadUserData();
  }, [router]);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash === '#goals') {
      const el = document.getElementById('goals');
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [loading]);

  useEffect(() => {
    if (!user) return;
    fetch('/api/user/goals', { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data) {
          setGoals(data);
          setGoalsDoor(String(data.weekly_door_goal ?? 100));
          setGoalsSessions(data.weekly_sessions_goal != null ? String(data.weekly_sessions_goal) : '');
          setGoalsMinutes(data.weekly_minutes_goal != null ? String(data.weekly_minutes_goal) : '');
        }
      })
      .catch(() => {});
  }, [user]);

  const handleSaveGoals = async () => {
    setGoalsSaving(true);
    try {
      const res = await fetch('/api/user/goals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          weekly_door_goal: Math.max(0, parseInt(goalsDoor, 10) || 0),
          weekly_sessions_goal: goalsSessions === '' ? null : Math.max(0, parseInt(goalsSessions, 10) || 0),
          weekly_minutes_goal: goalsMinutes === '' ? null : Math.max(0, parseInt(goalsMinutes, 10) || 0),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setGoals(data);
      }
    } finally {
      setGoalsSaving(false);
    }
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  };

  const handleUpgrade = async () => {
    try {
      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId: 'price_pro_monthly' }),
      });

      const { url } = await response.json();
      if (url) {
        window.location.href = url;
      }
    } catch (error) {
      console.error('Error creating checkout:', error);
      alert('Failed to create checkout session');
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
        <div className="max-w-4xl px-4 sm:px-6 lg:px-8 py-4">
          <h1 className="text-2xl font-bold dark:text-white">Settings</h1>
        </div>
      </header>
      
      <main className="max-w-4xl px-4 sm:px-6 lg:px-8 py-6">
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

          {/* Subscription Section */}
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
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="text-base font-medium dark:text-white">Plan</p>
                    {profile?.pro_active ? (
                      <Badge className="bg-green-500 hover:bg-green-600">Pro</Badge>
                    ) : (
                      <Badge variant="outline">Free</Badge>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {profile?.pro_active 
                      ? 'You have access to all Pro features'
                      : 'Upgrade to Pro for unlimited QR codes and advanced features'
                    }
                  </p>
                </div>
                {!profile?.pro_active && (
                  <Button onClick={handleUpgrade} size="sm">
                    Upgrade to Pro
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Weekly Goals Section - linked from Home "Edit goals" */}
          <Card id="goals">
            <CardHeader>
              <div className="flex items-center gap-2">
                <BowArrowIcon className="w-5 h-5" />
                <CardTitle>Weekly Goals</CardTitle>
              </div>
              <CardDescription>
                Goals shown on your Home dashboard (doors, sessions, time)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="goals-doors">Doors per week</Label>
                <Input
                  id="goals-doors"
                  type="number"
                  min={0}
                  value={goalsDoor}
                  onChange={(e) => setGoalsDoor(e.target.value)}
                  className="max-w-[120px]"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="goals-sessions">Sessions per week (optional)</Label>
                <Input
                  id="goals-sessions"
                  type="number"
                  min={0}
                  placeholder="Leave empty to hide"
                  value={goalsSessions}
                  onChange={(e) => setGoalsSessions(e.target.value)}
                  className="max-w-[120px]"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="goals-minutes">Minutes per week (optional)</Label>
                <Input
                  id="goals-minutes"
                  type="number"
                  min={0}
                  placeholder="Leave empty to hide"
                  value={goalsMinutes}
                  onChange={(e) => setGoalsMinutes(e.target.value)}
                  className="max-w-[120px]"
                />
              </div>
              <Button onClick={handleSaveGoals} disabled={goalsSaving} size="sm">
                {goalsSaving ? 'Saving...' : 'Save goals'}
              </Button>
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
