'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Image from 'next/image';
import { MessageCircleQuestion, Moon, Sun, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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

type UserProfileLite = {
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
};

function initialsFromName(nameOrEmail: string | null): string {
  const value = (nameOrEmail ?? '').trim();
  if (!value) return 'U';
  const parts = value.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export default function AppTopHeader() {
  const { theme, toggleTheme } = useTheme();
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();
  const { currentWorkspace, membershipsByWorkspaceId, refreshWorkspaces } = useWorkspace();
  const [profile, setProfile] = useState<UserProfileLite>({
    email: null,
    fullName: null,
    avatarUrl: null,
  });
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [isFounder, setIsFounder] = useState<boolean>(false);
  const [profileEditOpen, setProfileEditOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    fetch('/api/access/state', { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (mounted && data && typeof data.isFounder === 'boolean') {
          setIsFounder(data.isFounder);
        }
      })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

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
            });
          });
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, []);

  const currentRole = useMemo(() => {
    if (!currentWorkspace) return null;
    return membershipsByWorkspaceId[currentWorkspace.id] ?? null;
  }, [currentWorkspace, membershipsByWorkspaceId]);

  const sendFeedback = async () => {
    const trimmed = feedbackMessage.trim();
    if (!trimmed) return;

    setFeedbackError(null);
    setFeedbackSuccess(null);
    setFeedbackSubmitting(true);
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: trimmed,
          workspaceId: currentWorkspace?.id ?? null,
          role: currentRole ?? null,
          page: typeof window !== 'undefined' ? window.location.pathname : null,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setFeedbackError(payload?.error ?? 'Failed to send feedback. Please try again.');
        return;
      }

      setFeedbackSuccess('Thanks for the feedback. We received your message.');
      setFeedbackMessage('');
    } catch {
      setFeedbackError('Failed to send feedback. Please check your connection and try again.');
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  return (
    <>
      <header className="shrink-0 bg-white dark:bg-[#0f0f10]">
        <div className="flex h-12 items-center justify-between pl-2 pr-4">
          <div className="flex min-w-0 items-center gap-3">
            <Image
              src="/flyr-logo-wide-light.svg"
              alt="FLYR"
              width={72}
              height={28}
              className="h-6 w-auto dark:hidden"
            />
            <Image
              src="/flyr-logo-wide-dark.svg"
              alt="FLYR"
              width={72}
              height={28}
              className="hidden h-6 w-auto dark:block"
            />

            <div className="min-w-0 text-sm font-medium text-foreground">
              <span className="mr-2 text-muted-foreground">/</span>
              <span className="truncate align-middle">{currentWorkspace?.name ?? 'Workspace'}</span>
              <span className="mx-2 text-muted-foreground">/</span>
              <span className="capitalize text-muted-foreground">{isFounder ? 'Founder' : (currentRole ?? 'member')}</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFeedbackOpen(true)}
              className="gap-2"
            >
              <MessageCircleQuestion className="h-4 w-4" />
              Feedback ?
            </Button>

            <Button
              variant="outline"
              size="icon"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
              title={isFullscreen ? 'Exit full screen' : 'Full screen'}
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

            <button
              type="button"
              onClick={() => setProfileEditOpen(true)}
              className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-xs font-semibold text-foreground transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              title={profile.fullName ?? profile.email ?? 'Edit profile'}
              aria-label="Edit profile"
            >
              {profile.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatarUrl}
                  alt="Profile"
                  className="h-full w-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span>{initialsFromName(profile.fullName ?? profile.email)}</span>
              )}
            </button>
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
        <DialogContent>
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
    </>
  );
}
