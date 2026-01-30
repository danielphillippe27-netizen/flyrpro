'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CampaignsListView } from '@/components/home/CampaignsListView';
import { FarmListView } from '@/components/home/FarmListView';
import { CreateHubView } from '@/components/CreateHubView';
import { createClient } from '@/lib/supabase/client';
import Image from 'next/image';

function HomePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showCreateHub, setShowCreateHub] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    
    // Safety check: ensure Supabase client is properly initialized
    if (!supabase || !supabase.auth) {
      console.error('❌ Supabase client not properly initialized');
      router.push('/login');
      return;
    }
    
    let hasRedirected = false;
    
    // Handle old magic links that redirect directly to /home?code=...
    // Redirect them to the callback route
    const code = searchParams.get('code');
    if (code) {
      // Old magic link - redirect to callback route
      router.replace(`/auth/callback?code=${code}&next=/home`);
      return;
    }
    
    // Check auth and redirect if not authenticated
    // Code exchange is now handled by /auth/callback route
    const checkAuth = async () => {
      try {
        // Small delay to ensure cookies are available
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        console.log("SESSION DEBUG:", { session, error: sessionError });
        
        if (session?.user) {
          setUserId(session.user.id);
          setIsCheckingAuth(false);
          return;
        }
        
        // Try getUser as fallback (this makes a network call)
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        console.log("USER DEBUG:", { user, error: userError });
        
        if (user) {
          setUserId(user.id);
          setIsCheckingAuth(false);
          return;
        }
        
        // Only redirect if we've confirmed there's no user
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
    
    checkAuth();

    // Listen for auth state changes
    const authStateChangeResult = supabase.auth.onAuthStateChange((event, session) => {
      console.log("AUTH STATE CHANGE:", { event, session: session?.user?.id });
      
      if (session?.user) {
        setUserId(session.user.id);
        setIsCheckingAuth(false);
      } else if (event === 'SIGNED_OUT' && !hasRedirected) {
        hasRedirected = true;
        setIsCheckingAuth(false);
        router.push('/login');
      } else if (event === 'TOKEN_REFRESHED' && session?.user) {
        // Token refreshed, user is still logged in
        setUserId(session.user.id);
        setIsCheckingAuth(false);
      }
    });

    return () => {
      // Safely unsubscribe only if subscription exists
      if (authStateChangeResult?.data?.subscription) {
        authStateChangeResult.data.subscription.unsubscribe();
      }
    };
  }, [router, searchParams]);

  // Show loading state while checking auth
  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-gray-600 dark:text-gray-400">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <Image 
            src="/flyr-logo-black.svg" 
            alt="FLYR" 
            width={40} 
            height={40}
            className="h-10 w-10 dark:invert"
          />
          <Button 
            onClick={() => setShowCreateHub(true)} 
            className="bg-red-600 hover:bg-red-700 text-white rounded-full w-12 h-12 p-0 flex items-center justify-center"
            aria-label="Create"
          >
            <Plus className="w-5 h-5" />
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Tabs defaultValue="campaigns" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
            <TabsTrigger value="farms">Farms</TabsTrigger>
          </TabsList>
          
          <TabsContent value="campaigns" className="mt-6">
            <CampaignsListView userId={userId} />
          </TabsContent>
          
          <TabsContent value="farms" className="mt-6">
            <FarmListView userId={userId} />
          </TabsContent>
        </Tabs>
      </main>

      <CreateHubView open={showCreateHub} onClose={() => setShowCreateHub(false)} />
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="text-gray-600 dark:text-gray-400">Loading...</div>
        </div>
      </div>
    }>
      <HomePageContent />
    </Suspense>
  );
}

