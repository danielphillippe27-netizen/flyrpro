'use client';

import { useState, useEffect } from 'react';
import { YouViewContent } from './YouViewContent';
import { createClient } from '@/lib/supabase/client';

export function StatsPageView() {
  const [userId, setUserId] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id ?? null);
      setAuthChecked(true);
    });
  }, []);

  return (
    <div className="mt-6">
      <YouViewContent userId={userId} authChecked={authChecked} />
    </div>
  );
}

