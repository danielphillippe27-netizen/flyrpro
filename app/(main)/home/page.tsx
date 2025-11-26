'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
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
  const [showCreateHub, setShowCreateHub] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    
    // Check auth and redirect if not authenticated
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.push('/login');
        return;
      }
      setUserId(user.id);
    });

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        setUserId(session.user.id);
      } else if (event === 'SIGNED_OUT') {
        router.push('/login');
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [router]);

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

