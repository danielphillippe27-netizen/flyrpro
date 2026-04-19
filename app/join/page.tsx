'use client';

import { useCallback, useEffect, useRef, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getClientAsync } from '@/lib/supabase/client';
import { Loader2, Users } from 'lucide-react';

type InviteInfo = {
  valid: boolean;
  workspaceName: string | null;
  campaignId?: string | null;
  campaignTitle?: string | null;
  sessionId?: string | null;
  email: string | null;
  role: string;
};

const PENDING_INVITE_PROFILE_KEY = 'flyr.pendingInviteProfile';

function tryOpenInviteInApp(options: {
  token: string;
  fallbackRedirect: string;
}): boolean {
  if (typeof window === 'undefined') return false;

  const userAgent = window.navigator.userAgent ?? '';
  const isIOSDevice = /iPhone|iPad|iPod/i.test(userAgent);
  if (!isIOSDevice) {
    return false;
  }

  const appURL = `flyr://join?token=${encodeURIComponent(options.token)}`;
  const startedAt = Date.now();

  window.setTimeout(() => {
    if (Date.now() - startedAt < 1600) {
      window.location.replace(options.fallbackRedirect);
    }
  }, 1200);

  window.location.href = appURL;
  return true;
}

function normalizeInviteEmail(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/^['"]+|['"]+$/g, '').toLowerCase();
  if (normalized.endsWith('@invite.flyr.invalid')) {
    return null;
  }
  return normalized.length > 0 ? normalized : null;
}

function JoinContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<{ id: string; email: string | null } | null>(null);
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasAutoAcceptedRef = useRef(false);

  useEffect(() => {
    if (!token?.trim()) {
      setError('Missing invite token');
      setAuthChecked(true);
      return;
    }

    let mounted = true;
    getClientAsync()
      .then((supabase) => supabase.auth.getUser())
      .then(({ data: { user: u } }) => {
        if (!mounted) return;
        setUser(u ?? null);
        setAuthChecked(true);
        if (!u) return;
        fetch(`/api/invites/validate?token=${encodeURIComponent(token)}`)
          .then((r) => r.json())
          .then((data) => {
            if (!mounted) return;
            if (!data?.valid) {
              setInvite(null);
              return;
            }

            setInvite({
              ...data,
              email: normalizeInviteEmail(data.email),
            });
          })
          .catch(() => {
            if (mounted) setInvite(null);
          });
      })
      .catch(() => {
        if (mounted) setAuthChecked(true);
      });
    return () => {
      mounted = false;
    };
  }, [token]);

  useEffect(() => {
    if (!authChecked || user) return;
    const inviteToken = token?.trim() ?? '';
    const loginUrl = `/login?token=${encodeURIComponent(inviteToken)}&next=${encodeURIComponent(`/join?token=${encodeURIComponent(inviteToken)}`)}`;
    router.replace(loginUrl);
  }, [authChecked, user, token, router]);

  const handleAccept = useCallback(async (mode: 'manual' | 'auto' = 'manual') => {
    if (!token || !invite) return;
    setError(null);
    setLoading(true);
    try {
      let firstName: string | undefined;
      let lastName: string | undefined;
      if (typeof window !== 'undefined') {
        const stored = window.localStorage.getItem(`${PENDING_INVITE_PROFILE_KEY}:${token}`);
        if (stored) {
          try {
            const parsed = JSON.parse(stored) as {
              firstName?: unknown;
              lastName?: unknown;
            };
            if (typeof parsed.firstName === 'string' && parsed.firstName.trim()) {
              firstName = parsed.firstName.trim();
            }
            if (typeof parsed.lastName === 'string' && parsed.lastName.trim()) {
              lastName = parsed.lastName.trim();
            }
          } catch {
            // Ignore malformed local data from earlier app versions.
          }
        }
      }

      const res = await fetch('/api/invites/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          token,
          ...(firstName ? { firstName } : {}),
          ...(lastName ? { lastName } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.redirect) {
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem(`${PENDING_INVITE_PROFILE_KEY}:${token}`);
        }
        if (tryOpenInviteInApp({ token, fallbackRedirect: data.redirect })) {
          return;
        }
        router.push(data.redirect);
        return;
      }
      setError(data?.error ?? 'Failed to join workspace');
    } catch {
      setError(
        mode === 'auto'
          ? 'Could not auto-join yet. Use the button below to try again.'
          : 'Network error. Please try again.'
      );
    } finally {
      setLoading(false);
    }
  }, [invite, router, token]);

  useEffect(() => {
    if (!invite || !user || !token || loading || hasAutoAcceptedRef.current) return;
    const userEmail = normalizeInviteEmail(user.email);
    const inviteEmail = normalizeInviteEmail(invite.email);
    if (inviteEmail && (!userEmail || userEmail !== inviteEmail)) return;
    hasAutoAcceptedRef.current = true;
    handleAccept('auto');
  }, [handleAccept, invite, loading, token, user]);

  if (!authChecked || (!user && token)) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!token?.trim() || error === 'Missing invite token') {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background flex flex-col items-center justify-center p-6">
        <p className="text-muted-foreground">Invalid invite link. Check the URL and try again.</p>
        <Button asChild className="mt-4">
          <Link href="/login">Go to login</Link>
        </Button>
      </div>
    );
  }

  if (authChecked && user && invite === undefined) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (authChecked && user && invite === null) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background flex flex-col items-center justify-center p-6">
        <p className="text-muted-foreground">This invite is invalid or has expired.</p>
        <Button asChild className="mt-4">
          <Link href="/home">Go to dashboard</Link>
        </Button>
      </div>
    );
  }

  if (!invite?.valid) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background flex flex-col items-center justify-center p-6">
        <p className="text-muted-foreground">This invite is invalid or has expired.</p>
        <Button asChild className="mt-4">
          <Link href="/home">Go to dashboard</Link>
        </Button>
      </div>
    );
  }

  const inviteEmail = normalizeInviteEmail(invite.email);
  const userEmail = normalizeInviteEmail(user?.email);
  const emailMatch = !inviteEmail || (!!userEmail && userEmail === inviteEmail);
  const targetName = invite.campaignTitle ?? invite.workspaceName ?? 'workspace';
  const isLiveInvite = Boolean(invite.sessionId || invite.campaignId);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="flex justify-center">
          <Users className="h-12 w-12 text-primary" />
        </div>
        <h1 className="text-xl font-semibold text-foreground">
          Join {targetName}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isLiveInvite
            ? `You have been invited to join this live session as ${invite.role}.`
            : `You have been invited to join as ${invite.role}.`}
          {!emailMatch && inviteEmail && (
            <span className="block mt-2 text-amber-600 dark:text-amber-400">
              This invite was sent to {inviteEmail}. Sign in with that email to accept.
            </span>
          )}
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          onClick={() => handleAccept('manual')}
          disabled={!emailMatch || loading}
          className="w-full"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Joining…
            </>
          ) : (
            isLiveInvite ? 'Join live session' : 'Join workspace'
          )}
        </Button>
        <Button variant="ghost" asChild>
          <Link href="/home">Cancel</Link>
        </Button>
      </div>
    </div>
  );
}

export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 dark:bg-background flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <JoinContent />
    </Suspense>
  );
}
