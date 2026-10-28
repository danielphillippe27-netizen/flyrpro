'use client';
import { useEffect } from 'react';
import { useWorkspace } from '@/lib/workspace-context';
import { createClient } from '@/lib/supabase/client';
import { hasMacBridge, macNative } from '@/lib/mac-companion/client';
/** The shared session stays in WebKit cookies. Only non-secret identity/scope goes native. */
export function MacSessionBridge() {
  const { currentWorkspaceId } = useWorkspace();
  useEffect(() => {
    if (!hasMacBridge()) return;
    let active = true;
    const api = createClient();
    const bind = async () => {
      const { data: { session } } = await api.auth.getSession();
      if (!active) return;
      if (!session?.user || !currentWorkspaceId) { await macNative('session-stop').catch(() => {}); return; }
      await macNative('session', { userId: session.user.id, workspaceId: currentWorkspaceId }).catch(() => {});
    };
    void bind();
    const { data } = api.auth.onAuthStateChange(() => { queueMicrotask(() => void bind()); });
    const interval = setInterval(() => void bind(), 10000);
    return () => { active = false; clearInterval(interval); data.subscription.unsubscribe(); void macNative('clear-approval').catch(() => {}); };
  }, [currentWorkspaceId]);
  return null;
}
