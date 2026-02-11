'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getClientAsync } from '@/lib/supabase/client';
import { Hexagon } from 'lucide-react';

export default function TerritoryPage() {
  const router = useRouter();
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  useEffect(() => {
    let hasRedirected = false;
    let authSubscription: { unsubscribe: () => void } | null = null;

    const run = async () => {
      try {
        const supabase = await getClientAsync();
        if (!supabase?.auth) {
          router.push('/login');
          return;
        }

        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          setIsCheckingAuth(false);
          authSubscription = supabase.auth.onAuthStateChange((event, s) => {
            if (event === 'SIGNED_OUT' && !hasRedirected) {
              hasRedirected = true;
              router.push('/login');
            }
          }).data.subscription;
          return;
        }

        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setIsCheckingAuth(false);
          authSubscription = supabase.auth.onAuthStateChange((event, s) => {
            if (event === 'SIGNED_OUT' && !hasRedirected) {
              hasRedirected = true;
              router.push('/login');
            }
          }).data.subscription;
          return;
        }

        if (!hasRedirected) {
          hasRedirected = true;
          setIsCheckingAuth(false);
          router.push('/login');
        }
      } catch (error) {
        console.error('Auth check error:', error);
        setIsCheckingAuth(false);
        if (!hasRedirected) {
          hasRedirected = true;
          router.push('/login');
        }
      }
    };

    run();

    return () => {
      authSubscription?.unsubscribe();
    };
  }, [router]);

  if (isCheckingAuth) {
    return (
      <div className="flex items-center justify-center h-full min-h-[320px] text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[320px] px-6 text-center">
      <Hexagon className="w-12 h-12 text-muted-foreground mb-4" />
      <h2 className="text-lg font-semibold text-foreground mb-1">Coming soon</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        Territory management is on the way. Check back later.
      </p>
    </div>
  );
}
