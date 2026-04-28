'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { getClientAsync } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type ResetState = 'checking' | 'ready' | 'invalid';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<ResetState>('checking');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let mounted = true;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const checkRecoverySession = async () => {
      try {
        const supabase = await getClientAsync();
        const currentUrl = new URL(window.location.href);
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const queryType = currentUrl.searchParams.get('type');
        const queryToken = currentUrl.searchParams.get('token');
        const queryTokenHash = currentUrl.searchParams.get('token_hash');
        const queryCode = currentUrl.searchParams.get('code');
        const hashType = hashParams.get('type');
        const hashAccessToken = hashParams.get('access_token');
        const hashRefreshToken = hashParams.get('refresh_token');

        const normalizeRecoveryUrl = () => {
          window.history.replaceState({}, document.title, '/reset-password');
        };

        if (queryType === 'recovery' && queryToken) {
          const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();

          if (!supabaseUrl) {
            throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL for recovery token verification.');
          }

          const verifyUrl = new URL('/auth/v1/verify', supabaseUrl);
          verifyUrl.searchParams.set('token', queryToken);
          verifyUrl.searchParams.set('type', 'recovery');
          verifyUrl.searchParams.set(
            'redirect_to',
            new URL('/reset-password', window.location.origin).toString()
          );

          window.location.replace(verifyUrl.toString());
          return;
        }

        if (queryType === 'recovery' && queryTokenHash) {
          const { error } = await supabase.auth.verifyOtp({
            type: 'recovery',
            token_hash: queryTokenHash,
          });

          if (error) {
            throw error;
          }

          normalizeRecoveryUrl();
        } else if (queryCode) {
          const { error } = await supabase.auth.exchangeCodeForSession(queryCode);

          if (error) {
            throw error;
          }

          normalizeRecoveryUrl();
        } else if (hashType === 'recovery' && hashAccessToken && hashRefreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: hashAccessToken,
            refresh_token: hashRefreshToken,
          });

          if (error) {
            throw error;
          }

          normalizeRecoveryUrl();
        }

        const applySessionState = async () => {
          const {
            data: { session },
          } = await supabase.auth.getSession();

          if (!mounted) return;
          setState(session?.user ? 'ready' : 'checking');
        };

        await applySessionState();

        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange((event, session) => {
          if (!mounted) return;
          if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session?.user)) {
            setState('ready');
          }
        });

        timeoutId = setTimeout(async () => {
          if (!mounted) return;
          const {
            data: { session },
          } = await supabase.auth.getSession();
          setState(session?.user ? 'ready' : 'invalid');
        }, 2000);

        return () => {
          subscription.unsubscribe();
        };
      } catch (error) {
        console.error('Failed to verify recovery session:', error);
        if (mounted) {
          setState('invalid');
        }
      }
    };

    let cleanup: (() => void) | undefined;
    checkRecoverySession().then((result) => {
      cleanup = result;
    });

    return () => {
      mounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      cleanup?.();
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (password.length < 6) {
      setMessage({ type: 'error', text: 'Use a password with at least 6 characters.' });
      return;
    }

    if (password !== confirmPassword) {
      setMessage({ type: 'error', text: 'Passwords do not match.' });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const supabase = await getClientAsync();
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        setMessage({
          type: 'error',
          text: error.message || 'Could not update your password. Please request a new reset link.',
        });
        return;
      }

      setMessage({ type: 'success', text: 'Password updated. Redirecting you back into FLYR...' });
      router.replace('/gate');
    } catch (error) {
      console.error('Failed to update password:', error);
      setMessage({
        type: 'error',
        text: 'Could not update your password. Please request a new reset link.',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dark min-h-screen bg-gradient-to-br from-black to-[#262626] flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-red-950/40 via-transparent to-black/80 pointer-events-none" />
      <div className="relative w-full max-w-xl rounded-2xl border border-white/15 bg-white/[0.06] px-10 py-7 backdrop-blur-2xl shadow-[0_24px_70px_rgba(0,0,0,0.6),0_10px_30px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.2)]">
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <Image
              src="/flyr-logo-wide-dark.svg"
              alt="FLYR"
              width={480}
              height={128}
              className="h-32 w-auto"
              priority
            />
          </div>
          <p className="text-[#AAAAAA] text-lg">
            {state === 'checking'
              ? 'Verifying your recovery link...'
              : 'Choose a new password for your account'}
          </p>
        </div>

        {state === 'ready' ? (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-white text-base">New password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Enter a new password"
                minLength={6}
                required
                disabled={loading}
                className="h-12 text-base text-white bg-white/[0.08] border border-white/15 placeholder:text-gray-500 focus-visible:border-white/40 focus-visible:ring-2 focus-visible:ring-white/40 backdrop-blur-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword" className="text-white text-base">Confirm password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Re-enter your new password"
                minLength={6}
                required
                disabled={loading}
                className="h-12 text-base text-white bg-white/[0.08] border border-white/15 placeholder:text-gray-500 focus-visible:border-white/40 focus-visible:ring-2 focus-visible:ring-white/40 backdrop-blur-sm"
              />
            </div>
            <Button
              type="submit"
              size="lg"
              className="w-full h-12 text-base bg-[#dc2626] text-white hover:bg-[#b91c1c] border border-red-900/40"
              disabled={loading}
            >
              {loading ? 'Updating password...' : 'Update password'}
            </Button>
          </form>
        ) : null}

        {state === 'invalid' ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-base text-red-300">
              This recovery link is invalid or expired. Request a new password reset email to continue.
            </div>
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="w-full h-12 text-base border-red-900/50 bg-[#991b1b] hover:bg-[#7f1d1d] text-white"
              onClick={() => router.replace('/login')}
            >
              Back to login
            </Button>
          </div>
        ) : null}

        {message ? (
          <div
            className={`mt-6 rounded-lg border p-4 text-base ${
              message.type === 'success'
                ? 'border-emerald-800/50 bg-emerald-950/50 text-emerald-200'
                : 'border-red-500/30 bg-red-500/10 text-red-400'
            }`}
          >
            {message.text}
          </div>
        ) : null}
      </div>
    </div>
  );
}
