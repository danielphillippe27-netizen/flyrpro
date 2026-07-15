'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck, Moon, Sun, Maximize2, Minimize2, Menu, LogOut, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useTheme } from '@/lib/theme-provider';
import { useFullscreen } from '@/lib/hooks/useFullscreen';
import { useWorkspace } from '@/lib/workspace-context';
import { getClientAsync } from '@/lib/supabase/client';
import { ProfileEditDialog } from '@/components/profile/ProfileEditDialog';
import { useMainLayoutNav } from '@/components/layout/MainLayoutNavContext';
import { countryCodeToFlag } from '@/lib/countries';
import { HelpMeSellFlyrDialog } from '@/components/scripts/HelpMeSellFlyrDialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

type UserProfileLite = {
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  countryCode: string | null;
};

type AppNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

function initialsFromName(nameOrEmail: string | null): string {
  const value = (nameOrEmail ?? '').trim();
  if (!value) return 'U';
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function notificationLink(data: Record<string, unknown> | null): string | null {
  const link = data?.link;
  return typeof link === 'string' && link.startsWith('/') ? link : null;
}

function notificationLabel(data: Record<string, unknown> | null): string | null {
  const label = data?.label;
  return typeof label === 'string' && label.trim() ? label.trim() : null;
}

function formatNotificationTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function AppTopHeader() {
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();
  const {
    currentWorkspace,
    membershipsByWorkspaceId,
    refreshWorkspaces,
    isFounder,
    accessLevel,
    planBadgeLabel,
  } = useWorkspace();
  const [profile, setProfile] = useState<UserProfileLite>({
    email: null,
    fullName: null,
    avatarUrl: null,
    countryCode: null,
  });
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [salesHelpOpen, setSalesHelpOpen] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [profileEditOpen, setProfileEditOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const [notificationActionBusyId, setNotificationActionBusyId] = useState<string | null>(null);
  const mainLayoutNav = useMainLayoutNav();

  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const supabase = await getClientAsync();
      await supabase.auth.signOut();
      router.replace('/login');
      router.refresh();
    } catch {
      setSigningOut(false);
    }
  };

  const refreshProfile = useCallback(() => {
    getClientAsync()
      .then((supabase) => supabase.auth.getUser())
      .then(({ data: { user } }) => {
        if (!user) return;
        fetch('/api/profile', { credentials: 'include' })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data) {
              const fullName =
                (data.first_name || data.last_name)
                  ? [data.first_name, data.last_name].filter(Boolean).join(' ')
                  : null;
              setProfile({
                email: data.email ?? user.email ?? null,
                fullName: fullName ?? ((typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name) ||
                  (typeof user.user_metadata?.name === 'string' && user.user_metadata.name) ||
                  null),
                avatarUrl: data.avatar_url ??
                  ((typeof user.user_metadata?.avatar_url === 'string' && user.user_metadata.avatar_url) ||
                  (typeof user.user_metadata?.picture === 'string' && user.user_metadata.picture) ||
                  null),
                countryCode: data.country_code ?? null,
              });
              return;
            }
            const fullName =
              (typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name) ||
              (typeof user.user_metadata?.name === 'string' && user.user_metadata.name) ||
              null;
            const avatarUrl =
              (typeof user.user_metadata?.avatar_url === 'string' && user.user_metadata.avatar_url) ||
              (typeof user.user_metadata?.picture === 'string' && user.user_metadata.picture) ||
              null;
            setProfile({
              email: user.email ?? null,
              fullName,
              avatarUrl,
              countryCode: null,
            });
          })
          .catch(() => {});
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let mounted = true;
    getClientAsync()
      .then((supabase) => supabase.auth.getUser())
      .then(({ data: { user } }) => {
        if (!mounted || !user) return;
        fetch('/api/profile', { credentials: 'include' })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (!mounted) return;
            if (data) {
              const fullName =
                (data.first_name || data.last_name)
                  ? [data.first_name, data.last_name].filter(Boolean).join(' ')
                  : null;
              setProfile({
                email: data.email ?? user.email ?? null,
                fullName: fullName ?? ((typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name) ||
                  (typeof user.user_metadata?.name === 'string' && user.user_metadata.name) ||
                  null),
                avatarUrl: data.avatar_url ??
                  ((typeof user.user_metadata?.avatar_url === 'string' && user.user_metadata.avatar_url) ||
                  (typeof user.user_metadata?.picture === 'string' && user.user_metadata.picture) ||
                  null),
                countryCode: data.country_code ?? null,
              });
              return;
            }
            const fullName =
              (typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name) ||
              (typeof user.user_metadata?.name === 'string' && user.user_metadata.name) ||
              null;
            const avatarUrl =
              (typeof user.user_metadata?.avatar_url === 'string' && user.user_metadata.avatar_url) ||
              (typeof user.user_metadata?.picture === 'string' && user.user_metadata.picture) ||
              null;
            setProfile({
              email: user.email ?? null,
              fullName,
              avatarUrl,
              countryCode: null,
            });
          })
          .catch(() => {
            if (!mounted) return;
            const fullName =
              (typeof user.user_metadata?.full_name === 'string' && user.user_metadata.full_name) ||
              (typeof user.user_metadata?.name === 'string' && user.user_metadata.name) ||
              null;
            const avatarUrl =
              (typeof user.user_metadata?.avatar_url === 'string' && user.user_metadata.avatar_url) ||
              (typeof user.user_metadata?.picture === 'string' && user.user_metadata.picture) ||
              null;
            setProfile({
              email: user.email ?? null,
              fullName,
              avatarUrl,
              countryCode: null,
            });
          });
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, []);

  const loadNotifications = useCallback(async () => {
    if (!currentWorkspace?.id) {
      setNotifications([]);
      setNotificationUnreadCount(0);
      setNotificationsLoading(false);
      setNotificationsError(null);
      return;
    }

    setNotificationsLoading(true);
    setNotificationsError(null);
    try {
      const response = await fetch(
        `/api/notifications?workspaceId=${encodeURIComponent(currentWorkspace.id)}&limit=30`,
        { credentials: 'include' }
      ).catch(() => null);
      if (!response) {
        setNotificationsError('Could not load notifications.');
        return;
      }
      const payload = (await response.json().catch(() => null)) as
        | { notifications?: AppNotification[]; unreadCount?: number; error?: string }
        | null;
      if (!response.ok) {
        setNotificationsError(payload?.error ?? 'Could not load notifications.');
        return;
      }
      setNotifications(Array.isArray(payload?.notifications) ? payload.notifications : []);
      setNotificationUnreadCount(Number(payload?.unreadCount ?? 0));
    } catch {
      setNotificationsError('Could not load notifications.');
    } finally {
      setNotificationsLoading(false);
    }
  }, [currentWorkspace?.id]);

  useEffect(() => {
    void loadNotifications();
    if (!currentWorkspace?.id) return;

    const intervalId = window.setInterval(() => {
      void loadNotifications();
    }, 60_000);
    return () => window.clearInterval(intervalId);
  }, [currentWorkspace?.id, loadNotifications]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('notifications') !== '1') return;
    setNotificationsOpen(true);
    void loadNotifications();
    const url = new URL(window.location.href);
    url.searchParams.delete('notifications');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }, [loadNotifications]);

  useEffect(() => {
    const openFeedback = () => {
      setFeedbackError(null);
      setFeedbackSuccess(null);
      setFeedbackOpen(true);
    };
    window.addEventListener('flyr:open-feedback', openFeedback);
    return () => window.removeEventListener('flyr:open-feedback', openFeedback);
  }, []);

  const markNotificationRead = useCallback(
    async (notificationId: string) => {
      if (!currentWorkspace?.id) return;
      const existing = notifications.find((notification) => notification.id === notificationId);
      if (!existing || existing.read_at) return;

      const readAt = new Date().toISOString();
      setNotifications((current) =>
        current.map((notification) =>
          notification.id === notificationId ? { ...notification, read_at: readAt } : notification
        )
      );
      setNotificationUnreadCount((current) => Math.max(0, current - 1));

      try {
        await fetch('/api/notifications', {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspaceId: currentWorkspace.id,
            notificationId,
          }),
        });
      } catch {
        void loadNotifications();
      }
    },
    [currentWorkspace?.id, loadNotifications, notifications]
  );

  const markAllNotificationsRead = useCallback(async () => {
    if (!currentWorkspace?.id || notificationUnreadCount === 0) return;

    const readAt = new Date().toISOString();
    setNotifications((current) =>
      current.map((notification) => notification.read_at ? notification : { ...notification, read_at: readAt })
    );
    setNotificationUnreadCount(0);

    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: currentWorkspace.id,
          markAllRead: true,
        }),
      });
    } catch {
      void loadNotifications();
    }
  }, [currentWorkspace?.id, loadNotifications, notificationUnreadCount]);

  const respondToCampaignAssignment = useCallback(
    async (notification: AppNotification, action: 'accept' | 'decline') => {
      const assignmentId = notification.data?.assignmentId;
      if (typeof assignmentId !== 'string' || !assignmentId) return;
      setNotificationActionBusyId(notification.id);
      setNotificationsError(null);
      try {
        const response = await fetch('/api/campaign-assignments/status', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assignmentId, action }),
        });
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) {
          setNotificationsError(payload?.error ?? 'Could not update assignment.');
          return;
        }
        await loadNotifications();
        router.refresh();
      } catch {
        setNotificationsError('Could not update assignment.');
      } finally {
        setNotificationActionBusyId(null);
      }
    },
    [loadNotifications, router]
  );

  const currentRole = useMemo(() => {
    if (!currentWorkspace) return null;
    return membershipsByWorkspaceId[currentWorkspace.id] ?? null;
  }, [currentWorkspace, membershipsByWorkspaceId]);
  const isTrialBadge = Boolean(planBadgeLabel && /trial/i.test(planBadgeLabel));
  const profileFlag = countryCodeToFlag(profile.countryCode);
  const displayName = profile.fullName ?? profile.email ?? 'User';
  const showSalesHelp = accessLevel === 'salesperson' || isFounder;
  const showPlanAndFeedback = accessLevel !== 'salesperson';

  const sendFeedback = async () => {
    const trimmed = feedbackMessage.trim();
    if (!trimmed) return;

    setFeedbackError(null);
    setFeedbackSuccess(null);
    setFeedbackSubmitting(true);
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: trimmed,
          workspaceId: currentWorkspace?.id ?? null,
          role: currentRole ?? null,
          page: typeof window !== 'undefined' ? window.location.href : null,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        if (response.status === 401) {
          setFeedbackError('Your session expired. Please sign in again, then resend your feedback.');
          return;
        }
        setFeedbackError(payload?.error ?? 'Failed to send feedback. Please try again.');
        return;
      }

      setFeedbackSuccess('Thanks for the feedback. We received your message.');
      setFeedbackMessage('');
      window.dispatchEvent(new CustomEvent('flyr:feedback-submitted', { detail: { message: trimmed } }));
    } catch {
      setFeedbackError('Failed to send feedback. Please check your connection and try again.');
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  return (
    <>
      <header className="shrink-0 bg-white dark:bg-[#0f0f10]">
        <div className="flex h-12 items-center justify-between gap-2 pl-2 pr-3 sm:pr-4">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            {mainLayoutNav ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 md:hidden"
                onClick={mainLayoutNav.openMobileNav}
                aria-label="Open menu"
              >
                <Menu className="h-5 w-5" />
              </Button>
            ) : null}
            <Image
              src="/brand/wolfgrid-header-light.svg"
              alt="WolfGrid"
              width={120}
              height={60}
              className="h-20 w-auto max-w-[min(58vw,360px)] shrink-0 object-contain object-left dark:hidden"
            />
            <Image
              src="/brand/wolfgrid-header-dark.svg"
              alt="WolfGrid"
              width={120}
              height={60}
              className="hidden h-20 w-auto max-w-[min(58vw,360px)] shrink-0 object-contain object-left dark:block"
            />

            {accessLevel === 'salesperson' ? (
              <div className="hidden min-w-0 text-sm font-medium text-foreground md:flex md:items-center">
                <span className="mr-2 text-muted-foreground">/</span>
                <span className="truncate align-middle">Salesperson</span>
                <span className="mx-2 text-muted-foreground">/</span>
                <span className="truncate text-muted-foreground">{displayName}</span>
              </div>
            ) : isFounder ? (
              <div className="hidden min-w-0 text-sm font-medium text-foreground md:flex md:items-center">
                <span className="mr-2 text-muted-foreground">/</span>
                <span className="truncate align-middle">{currentWorkspace?.name ?? 'Workspace'}</span>
                <span className="mx-2 text-muted-foreground">/</span>
                <span className="capitalize text-muted-foreground">Founder</span>
              </div>
            ) : currentWorkspace && currentRole ? (
              <div className="hidden min-w-0 text-sm font-medium text-foreground md:flex md:items-center">
                <span className="mr-2 text-muted-foreground">/</span>
                <span className="truncate align-middle">{currentWorkspace?.name ?? 'Workspace'}</span>
                <span className="mx-2 text-muted-foreground">/</span>
                <span className="capitalize text-muted-foreground">{currentRole}</span>
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            {showPlanAndFeedback && planBadgeLabel ? (
              <div
                className={`inline-flex max-w-[5.5rem] truncate rounded-md border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold sm:max-w-none sm:px-2 sm:py-1 sm:text-[11px] ${
                  isTrialBadge ? 'text-red-600 dark:text-red-400' : 'text-foreground'
                }`}
              >
                {planBadgeLabel}
              </div>
            ) : null}
            {showPlanAndFeedback ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFeedbackOpen(true)}
                className="px-2 sm:px-3"
                data-self-serve-demo-flow="true"
              >
                <span>Feedback ?</span>
              </Button>
            ) : null}

            {showSalesHelp ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSalesHelpOpen(true)}
                className="px-2 sm:px-3"
                aria-label="Help me sell WolfGrid"
                title="Help me sell WolfGrid"
              >
                <span className="hidden lg:inline">Help Me Sell WolfGrid</span>
              </Button>
            ) : null}

            <Button
              variant="outline"
              size="icon"
              onClick={() => setNotificationsOpen(true)}
              aria-label="Notifications"
              title="Notifications"
              className="relative"
            >
              <Bell className="h-4 w-4" />
              {notificationUnreadCount > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white">
                  {notificationUnreadCount > 9 ? '9+' : notificationUnreadCount}
                </span>
              ) : null}
            </Button>

            <Button
              variant="outline"
              size="icon"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
              title={isFullscreen ? 'Exit full screen' : 'Full screen'}
              className="hidden sm:inline-flex"
            >
              {isFullscreen ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>

            <Button
              variant="outline"
              size="icon"
              onClick={toggleTheme}
              aria-label="Toggle theme"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-xs font-semibold text-foreground transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  title={profile.fullName ?? profile.email ?? 'Profile menu'}
                  aria-label="Open profile menu"
                >
                  {profile.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={profile.avatarUrl}
                      alt="Profile"
                      className="h-full w-full rounded-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span>{initialsFromName(profile.fullName ?? profile.email)}</span>
                  )}
                  {profileFlag ? (
                    <span className="absolute -bottom-1 -right-1 rounded-full bg-background text-[13px] leading-none">
                      {profileFlag}
                    </span>
                  ) : null}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="min-w-0">
                  <span className="block truncate">{profile.fullName ?? 'Your profile'}</span>
                  {profile.email ? (
                    <span className="block truncate text-xs font-normal text-muted-foreground">{profile.email}</span>
                  ) : null}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setProfileEditOpen(true)}>
                  <UserRound />
                  Edit profile
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" disabled={signingOut} onSelect={() => void handleSignOut()}>
                  <LogOut />
                  {signingOut ? 'Signing out…' : 'Sign out'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="h-px w-full bg-border/90" />
      </header>

      <ProfileEditDialog
        open={profileEditOpen}
        onOpenChange={setProfileEditOpen}
        onSaved={() => {
          refreshProfile();
          refreshWorkspaces();
        }}
      />

      {showSalesHelp ? (
        <HelpMeSellFlyrDialog open={salesHelpOpen} onOpenChange={setSalesHelpOpen} />
      ) : null}

      <Dialog
        open={feedbackOpen}
        onOpenChange={(open) => {
          setFeedbackOpen(open);
          if (!open) {
            setFeedbackError(null);
            setFeedbackSuccess(null);
            setFeedbackSubmitting(false);
          }
        }}
      >
        <DialogContent data-self-serve-demo-allow="true">
          <DialogHeader>
            <DialogTitle>Send Feedback</DialogTitle>
            <DialogDescription>
              Share what we should improve and we will send it directly to the team.
            </DialogDescription>
          </DialogHeader>

          <Textarea
            value={feedbackMessage}
            onChange={(e) => setFeedbackMessage(e.target.value)}
            placeholder="What should we improve?"
            rows={6}
            disabled={feedbackSubmitting}
            data-gramm="false"
            data-gramm_editor="false"
            data-enable-grammarly="false"
          />
          {feedbackError ? (
            <p className="text-sm text-destructive">{feedbackError}</p>
          ) : null}
          {feedbackSuccess ? (
            <p className="text-sm text-emerald-600 dark:text-emerald-400">{feedbackSuccess}</p>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setFeedbackOpen(false)} disabled={feedbackSubmitting}>
              Cancel
            </Button>
            <Button onClick={sendFeedback} disabled={!feedbackMessage.trim() || feedbackSubmitting}>
              {feedbackSubmitting ? 'Sending...' : 'Send'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={notificationsOpen}
        onOpenChange={(open) => {
          setNotificationsOpen(open);
          if (open) void loadNotifications();
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Notifications</DialogTitle>
            <DialogDescription>
              {notificationUnreadCount > 0
                ? `${notificationUnreadCount} unread notification${notificationUnreadCount === 1 ? '' : 's'}`
                : 'No unread notifications'}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
            {notificationsLoading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Loading notifications...</p>
            ) : null}
            {!notificationsLoading && notificationsError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {notificationsError}
              </div>
            ) : null}
            {!notificationsLoading && !notificationsError && notifications.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nothing new yet.</p>
            ) : null}
            {!notificationsLoading && !notificationsError
              ? notifications.map((notification) => {
                  const link = notificationLink(notification.data);
                  const label = notificationLabel(notification.data);
                  const isUnread = !notification.read_at;
                  const isActionableAssignment =
                    notification.type === 'campaign_assigned' &&
                    isUnread &&
                    typeof notification.data?.assignmentId === 'string';
                  const className = [
                    'block w-full rounded-lg border p-3 text-left transition hover:bg-muted/60',
                    isUnread
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-border bg-background',
                  ].join(' ');
                  const content = (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {notification.title}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">{notification.body}</p>
                        </div>
                        {label ? <Badge variant="secondary">{label}</Badge> : null}
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {formatNotificationTime(notification.created_at)}
                      </p>
                      {isActionableAssignment ? (
                        <div className="mt-3 flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            disabled={notificationActionBusyId === notification.id}
                            onClick={() => void respondToCampaignAssignment(notification, 'accept')}
                          >
                            Accept
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={notificationActionBusyId === notification.id}
                            onClick={() => void respondToCampaignAssignment(notification, 'decline')}
                          >
                            Decline
                          </Button>
                        </div>
                      ) : null}
                    </>
                  );

                  return link && !isActionableAssignment ? (
                    <a
                      key={notification.id}
                      href={link}
                      className={className}
                      onClick={() => {
                        void markNotificationRead(notification.id);
                        setNotificationsOpen(false);
                      }}
                    >
                      {content}
                    </a>
                  ) : isActionableAssignment ? (
                    <div key={notification.id} className={className}>
                      {content}
                    </div>
                  ) : (
                    <button
                      key={notification.id}
                      type="button"
                      className={className}
                      onClick={() => void markNotificationRead(notification.id)}
                    >
                      {content}
                    </button>
                  );
                })
              : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => void markAllNotificationsRead()}
              disabled={notificationUnreadCount === 0}
            >
              <CheckCheck className="mr-2 h-4 w-4" />
              Mark all read
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
