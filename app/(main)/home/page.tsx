'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CampaignsListView } from '@/components/home/CampaignsListView';
import { ChallengeListView } from '@/components/home/ChallengeListView';
import { FarmListView } from '@/components/home/FarmListView';
import { CreateHubView } from '@/components/CreateHubView';
import { createClient } from '@/lib/supabase/client';

export default function HomePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showCreateHub, setShowCreateHub] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    let hasRedirected = false;
    
    // Handle code exchange if coming from magic link
    const handleCodeExchange = async () => {
      const code = searchParams.get('code');
      if (code) {
        console.log("Handling code exchange:", code);
        try {
          const { data, error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            console.error("Code exchange error:", error);
            // If code exchange fails, redirect to login
            router.replace('/login');
            return false;
          } else {
            console.log("Code exchange successful:", data);
            // Remove code from URL
            router.replace('/home');
            return true;
          }
        } catch (error) {
          console.error("Code exchange exception:", error);
          router.replace('/login');
          return false;
        }
      }
      return null; // No code to exchange
    };
    
    // Check auth and redirect if not authenticated
    // Use getSession first to ensure cookies are read properly
    const checkAuth = async () => {
      try {
        // First, handle code exchange if present
        const codeExchanged = await handleCodeExchange();
        if (codeExchanged === false) {
          // Code exchange failed, already redirected
          setIsCheckingAuth(false);
          return;
        }
        
        // Wait a bit for cookies to be available (especially after code exchange)
        await new Promise(resolve => setTimeout(resolve, codeExchanged ? 200 : 100));
        
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
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
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
      subscription.unsubscribe();
    };
  }, [router, searchParams]);

  // Show loading state while checking auth
  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-gray-600">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold">FLYR</h1>
          <Button onClick={() => setShowCreateHub(true)} size="sm">
            <Plus className="w-4 h-4 mr-2" />
            Create
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Tabs defaultValue="campaigns" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
            <TabsTrigger value="challenges">Challenges</TabsTrigger>
            <TabsTrigger value="farms">Farms</TabsTrigger>
          </TabsList>
          
          <TabsContent value="campaigns" className="mt-6">
            <CampaignsListView userId={userId} />
          </TabsContent>
          
          <TabsContent value="challenges" className="mt-6">
            <ChallengeListView userId={userId} />
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

