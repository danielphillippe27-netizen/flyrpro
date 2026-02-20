'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getClientAsync } from '@/lib/supabase/client';
import { Loader2, Users } from 'lucide-react';

type InviteInfo = {
  valid: boolean;
  workspaceName: string | null;
  email: string;
  role: string;
};

function JoinContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<{ id: string; email: string | null } | null>(null);
  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            if (mounted) setInvite(data.valid ? data : null);
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
    const loginUrl = `/login?next=${encodeURIComponent(`/join?token=${encodeURIComponent(token ?? '')}`)}`;
    router.replace(loginUrl);
  }, [authChecked, user, token, router]);

  const handleAccept = async () => {
    if (!token || !invite) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/invites/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.redirect) {
        router.push(data.redirect);
        return;
      }
      setError(data?.error ?? 'Failed to join workspace');
    } catch (e) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

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

  const emailMatch =
    user?.email &&
    invite.email &&
    user.email.toLowerCase().trim() === invite.email.toLowerCase().trim();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="flex justify-center">
          <Users className="h-12 w-12 text-primary" />
        </div>
        <h1 className="text-xl font-semibold text-foreground">
          Join {invite.workspaceName ?? 'workspace'}
        </h1>
        <p className="text-sm text-muted-foreground">
          You have been invited to join as {invite.role}.
          {!emailMatch && (
            <span className="block mt-2 text-amber-600 dark:text-amber-400">
              This invite was sent to {invite.email}. Sign in with that email to accept.
            </span>
          )}
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          onClick={handleAccept}
          disabled={!emailMatch || loading}
          className="w-full"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Joining…
            </>
          ) : (
            'Join workspace'
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
