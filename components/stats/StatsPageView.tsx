'use client';

import { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LeaderboardContentView } from './LeaderboardContentView';
import { YouViewContent } from './YouViewContent';
import { createClient } from '@/lib/supabase/client';

export function StatsPageView() {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id || null);
    });
  }, []);

  return (
    <Tabs defaultValue="you" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="you">You</TabsTrigger>
        <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
      </TabsList>

      <TabsContent value="you" className="mt-6">
        <YouViewContent userId={userId} />
      </TabsContent>

      <TabsContent value="leaderboard" className="mt-6">
        <LeaderboardContentView />
      </TabsContent>
    </Tabs>
  );
}

