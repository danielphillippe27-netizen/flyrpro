'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getClientAsync } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import Image from 'next/image';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const router = useRouter();
  const [hasChecked, setHasChecked] = useState(false);

  // Show error from URL (e.g. after Apple OAuth or callback failure)
  useEffect(() => {
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    const error = params.get('error');
    const errorDescription = params.get('error_description') || '';
    if (error === 'apple_oauth_failed') {
      setMessage({ type: 'error', text: 'Could not start Sign up with Apple. Please try again.' });
    } else if (error === 'apple_exchange_failed') {
      if (typeof window !== 'undefined' && errorDescription) {
        console.warn('[Apple Sign-Up]', errorDescription);
      }
      setMessage({ type: 'error', text: 'Sign up with Apple did not complete. Please try again or use another sign-up option.' });
    } else if (error === 'pkce_verifier_mismatch') {
      setMessage({ type: 'error', text: 'Sign-up session expired or another sign-up was started. Please try again in a single tab (or use a private/incognito window).' });
    } else if (error === 'auth_failed' || error === 'callback_error') {
      setMessage({ type: 'error', text: 'Sign-up failed. Please try again.' });
    }
  }, []);

  // Redirect if already authenticated (only in browser; use getClientAsync to avoid auth-js .call error)
  useEffect(() => {
    if (hasChecked || typeof window === 'undefined') return;

    const checkAuth = async () => {
      try {
        setHasChecked(true);
        const supabase = await getClientAsync();
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();

        if (session?.user) {
          router.replace('/home');
          return;
        }
        if (!session && !sessionError) {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) router.replace('/home');
        }
      } catch (error) {
        console.error('Auth check error:', error);
      }
    };

    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasChecked]);

  const handleEmailSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const supabase = await getClientAsync();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
      });

      if (error) {
        console.error('Supabase Auth Error:', error);
        throw error;
      }

      if (data.session) {
        router.replace('/gate?next=/home');
        return;
      }

      setMessage({
        type: 'success',
        text: 'Account created. Check your email to confirm your account.',
      });
    } catch (error: any) {
      console.error('Sign up error:', error);
      setMessage({
        type: 'error',
        text: error.message || 'Failed to create account. Please try again.',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const redirectTo = `${window.location.origin}/auth/callback?next=/home`;
      const supabase = await getClientAsync();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      });
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to start Google sign-up.';
      setMessage({ type: 'error', text: msg });
      setLoading(false);
    }
  };

  const handleAppleSignUp = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const redirectTo = `${window.location.origin}/auth/callback?next=/home`;
      const supabase = await getClientAsync();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'apple',
        options: { redirectTo },
      });
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to start Sign up with Apple.';
      setMessage({ type: 'error', text: msg });
      setLoading(false);
    }
  };

  return (
    <div className="dark min-h-screen bg-gradient-to-br from-black to-[#262626] flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-red-950/40 via-transparent to-black/80 pointer-events-none" />
      <div className="relative w-full max-w-xl rounded-2xl border border-zinc-700/50 bg-[#242424] px-10 py-7 shadow-2xl">
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <Image
              src="/flyr-logo-wide-dark.svg"
              alt="FLYR"
              width={480}
              height={128}
              className="h-24 w-auto"
              priority
            />
          </div>
          <p className="text-[#AAAAAA] text-lg">
            Sign up to access your campaigns and analytics
          </p>
        </div>

        <form onSubmit={handleEmailSignUp} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-white text-base">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
              className="h-12 text-base text-white bg-[#2a2a2a] border-zinc-600 placeholder:text-gray-500 focus-visible:border-white focus-visible:ring-2 focus-visible:ring-white/40"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-white text-base">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Create a password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              disabled={loading}
              className="h-12 text-base text-white bg-[#2a2a2a] border-zinc-600 placeholder:text-gray-500 focus-visible:border-white focus-visible:ring-2 focus-visible:ring-white/40"
            />
          </div>
          <Button
            type="submit"
            size="lg"
            className="w-full h-12 text-base bg-[#ef4444] text-white hover:bg-[#dc2626] border-0"
            disabled={loading}
          >
            {loading ? 'Signing up...' : 'Sign up'}
          </Button>
        </form>

        <div className="relative mt-6">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-zinc-600" />
          </div>
          <div className="relative flex justify-center text-sm uppercase">
            <span className="bg-[#242424] px-2 text-[#AAAAAA]">Or continue with</span>
          </div>
        </div>

        <div className="mt-6 grid gap-3">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full h-12 text-base border-zinc-600 bg-[#2a2a2a] hover:bg-zinc-700 text-white"
            onClick={handleGoogleSignUp}
            disabled={loading}
          >
            <svg className="mr-2 h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Sign up with Google
          </Button>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="w-full h-12 text-base border-zinc-600 bg-[#2a2a2a] hover:bg-zinc-700 text-white"
            onClick={handleAppleSignUp}
            disabled={loading}
          >
            <svg
              className="mr-2 h-5 w-5 shrink-0"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
            </svg>
            Sign up with Apple
          </Button>
        </div>

        {message && (
          <div
            className={`mt-6 p-4 rounded-lg text-base ${
              message.type === 'success'
                ? 'bg-emerald-950/50 text-emerald-200 border border-emerald-800/50'
                : 'bg-red-500/10 text-red-400 border border-red-500/30'
            }`}
          >
            {message.text}
          </div>
        )}

        <p className="mt-5 text-sm text-center text-[#AAAAAA]">
          By signing up, you agree to our Terms of Service and Privacy Policy
        </p>
        <p className="mt-2 text-sm text-center">
          <Link href="/login" className="text-red-400 hover:text-red-300 underline underline-offset-2">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
