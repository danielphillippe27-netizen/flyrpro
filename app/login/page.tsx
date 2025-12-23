'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import Image from 'next/image';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const router = useRouter();
  const supabase = createClient();
  const [hasChecked, setHasChecked] = useState(false);

  // Redirect if already authenticated
  useEffect(() => {
    if (hasChecked) return; // Prevent multiple checks
    
    const checkAuth = async () => {
      setHasChecked(true);
      
      // Add a small delay to ensure cookies are available
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Use getSession first to check cookies
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (session?.user) {
        router.replace('/home'); // Use replace instead of push
        return;
      }
      
      // Only try getUser if getSession failed and we're sure there's no session
      if (!session && !sessionError) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          router.replace('/home');
        }
      }
    };
    
    checkAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasChecked]);

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      // Dynamically determine redirect URL based on current origin
      const redirectUrl = `${window.location.origin}/auth/callback?next=/home`;
      
      // Debug: Log the redirect URL being sent
      console.log('🔐 Auth Redirect URL:', redirectUrl);
      console.log('🌐 Current Origin:', window.location.origin);
      
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: redirectUrl,
        },
      });

      if (error) {
        console.error('❌ Supabase Auth Error:', error);
        throw error;
      }

      console.log('✅ Magic link sent successfully');
      setMessage({
        type: 'success',
        text: 'Check your email for the magic link to sign in!',
      });
    } catch (error: any) {
      console.error('❌ Sign in error:', error);
      setMessage({
        type: 'error',
        text: error.message || 'Failed to send magic link. Please try again.',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    setLoading(true);
    setMessage(null);

    try {
      // Dynamically determine redirect URL based on current origin
      const redirectUrl = `${window.location.origin}/auth/callback?next=/home`;
      
      // Debug: Log the redirect URL being sent
      console.log('🔐 Apple OAuth Redirect URL:', redirectUrl);
      console.log('🌐 Current Origin:', window.location.origin);
      
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'apple',
        options: {
          redirectTo: redirectUrl,
        },
      });

      if (error) {
        console.error('❌ Apple OAuth Error:', error);
        throw error;
      }
      
      console.log('✅ Apple OAuth redirect initiated');
    } catch (error: any) {
      console.error('❌ Apple sign in error:', error);
      setMessage({
        type: 'error',
        text: error.message || 'Failed to sign in with Apple. Please try again.',
      });
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <div className="flex flex-col items-center mb-4">
            <Image 
              src="/flyr-logo-black.svg" 
              alt="FLYR" 
              width={150} 
              height={40}
              className="h-10 w-auto mb-2"
            />
          </div>
          <CardDescription className="text-center">
            Sign in to access your campaigns and analytics
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleEmailSignIn} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Sending...' : 'Send Magic Link'}
            </Button>
          </form>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={handleAppleSignIn}
            disabled={loading}
          >
            <svg
              className="mr-2 h-4 w-4"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
            </svg>
            Sign in with Apple
          </Button>

          {message && (
            <div
              className={`p-3 rounded-md text-sm ${
                message.type === 'success'
                  ? 'bg-green-50 text-green-800 border border-green-200'
                  : 'bg-red-50 text-red-800 border border-red-200'
              }`}
            >
              {message.text}
            </div>
          )}
        </CardContent>
        <CardFooter className="flex flex-col space-y-2">
          <p className="text-xs text-center text-muted-foreground">
            By signing in, you agree to our Terms of Service and Privacy Policy
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
