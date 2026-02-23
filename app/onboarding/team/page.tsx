'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

function TeamOnboardingHandoffContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = useMemo(() => searchParams.get('code')?.trim() ?? '', [searchParams]);
  const [status, setStatus] = useState<'loading' | 'error' | 'idle'>('loading');
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!code) {
        try {
          const supabase = createClient();
          const { data } = await supabase.auth.getUser();
          if (cancelled) return;
          if (data.user) {
            router.replace('/onboarding/team/setup');
          } else {
            setStatus('idle');
            setMessage('Please sign in to continue team onboarding.');
          }
        } catch {
          if (!cancelled) {
            setStatus('idle');
            setMessage('Please sign in to continue team onboarding.');
          }
        }
        return;
      }

      const res = await fetch('/api/auth/redeem-handoff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ code }),
      });

      if (cancelled) return;

      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        setStatus('error');
        setMessage(payload?.error ?? 'This sign-in link is invalid or expired.');
        return;
      }

      router.replace('/onboarding/team/setup');
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [code, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-black text-white p-6">
      <div className="max-w-md w-full rounded-xl border border-zinc-700 bg-zinc-900 p-6 text-center space-y-3">
        {status === 'loading' && (
          <>
            <h1 className="text-xl font-semibold">Signing you in...</h1>
            <p className="text-sm text-zinc-400">Please wait while we securely continue setup.</p>
          </>
        )}
        {status !== 'loading' && (
          <>
            <h1 className="text-xl font-semibold">Set up your team</h1>
            <p className="text-sm text-zinc-400">{message}</p>
          </>
        )}
      </div>
    </div>
  );
}

export default function TeamOnboardingHandoffPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-black text-white p-6">
          <div className="max-w-md w-full rounded-xl border border-zinc-700 bg-zinc-900 p-6 text-center">
            <p className="text-sm text-zinc-400">Loading…</p>
          </div>
        </div>
      }
    >
      <TeamOnboardingHandoffContent />
    </Suspense>
  );
}
