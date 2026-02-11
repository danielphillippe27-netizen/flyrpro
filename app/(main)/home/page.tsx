'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CreateHubView } from '@/components/CreateHubView';
import { HomeDashboardView } from '@/components/home/HomeDashboardView';
import { getClientAsync } from '@/lib/supabase/client';

function HomePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showCreateHub, setShowCreateHub] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  useEffect(() => {
    let hasRedirected = false;
    let authSubscription: { unsubscribe: () => void } | null = null;

    const code = searchParams.get('code');
    if (code) {
      router.replace(`/auth/callback?code=${code}&next=/home`);
      return;
    }

    const run = async () => {
      try {
        const supabase = await getClientAsync();
        if (!supabase?.auth) {
          router.push('/login');
          return;
        }

        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (session?.user) {
          setUserId(session.user.id);
          setIsCheckingAuth(false);
          authSubscription = supabase.auth.onAuthStateChange((event, s) => {
            if (s?.user) setUserId(s.user.id);
            else if (event === 'SIGNED_OUT' && !hasRedirected) {
              hasRedirected = true;
              router.push('/login');
            }
          }).data.subscription;
          return;
        }

        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setUserId(user.id);
          setIsCheckingAuth(false);
          authSubscription = supabase.auth.onAuthStateChange((event, s) => {
            if (s?.user) setUserId(s.user.id);
            else if (event === 'SIGNED_OUT' && !hasRedirected) {
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
        console.error("Auth check error:", error);
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
  }, [router, searchParams]);

  if (isCheckingAuth) {
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
      <HomeDashboardView onCreateCampaign={() => setShowCreateHub(true)} />
      <CreateHubView open={showCreateHub} onClose={() => setShowCreateHub(false)} />
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 dark:bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="text-gray-600 dark:text-foreground/80">Loading...</div>
        </div>
      </div>
    }>
      <HomePageContent />
    </Suspense>
  );
}
