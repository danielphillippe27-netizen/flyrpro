'use client';

import { useState, useEffect } from 'react';
import { useWorkspace } from '@/lib/workspace-context';
import { SalespersonPerformanceView } from './SalespersonPerformanceView';
import { YouViewContent } from './YouViewContent';
import { createClient } from '@/lib/supabase/client';

export function StatsPageView() {
  const [userId, setUserId] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const { accessLevel } = useWorkspace();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id ?? null);
      setAuthChecked(true);
    });
  }, []);

  return (
    <div className="mt-6">
      {accessLevel === 'salesperson' ? (
        <SalespersonPerformanceView />
      ) : (
        <YouViewContent userId={userId} authChecked={authChecked} />
      )}
    </div>
  );
}
