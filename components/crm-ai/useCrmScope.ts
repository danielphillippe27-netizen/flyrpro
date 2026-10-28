'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/workspace-context';
export function useCrmScope() {
  const { currentWorkspaceId } = useWorkspace();
  const [userId, setUserId] = useState<string>();
  useEffect(() => {
    let active = true, revision = 0;
    const api = createClient();
    void api.auth.getSession().then(({ data }) => { if (active && revision === 0) setUserId(data.session?.user.id); });
    const { data } = api.auth.onAuthStateChange((_event, session) => { revision++; if (active) setUserId(session?.user.id); });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  return { workspaceId: currentWorkspaceId, userId, key: `${userId ?? 'signed-out'}:${currentWorkspaceId ?? 'no-workspace'}` };
}
