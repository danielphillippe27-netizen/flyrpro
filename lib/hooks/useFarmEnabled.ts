'use client';

import { useCallback, useEffect, useState } from 'react';
import { getClientAsync } from '@/lib/supabase/client';

const PREFERENCE_KEY = 'farm_enabled_by_workspace';

export function farmEnabledForWorkspace(metadata: Record<string, unknown> | undefined, workspaceId: string | null): boolean {
  const preferences = metadata?.[PREFERENCE_KEY];
  return !!workspaceId && !!preferences && typeof preferences === 'object'
    && (preferences as Record<string, unknown>)[workspaceId] === true;
}

export function useFarmEnabled(workspaceId: string | null) {
  const [state, setState] = useState<{ workspaceId: string | null; enabled: boolean; loading: boolean; error: string }>({ workspaceId: null, enabled: false, loading: true, error: '' });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    setState({ workspaceId, enabled: false, loading: !!workspaceId, error: '' });
    if (!workspaceId) return;
    void getClientAsync().then(async client => {
      if (cancelled) return;
      const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
        if (!cancelled) setState({ workspaceId, enabled: farmEnabledForWorkspace(session?.user.user_metadata, workspaceId), loading: false, error: '' });
      });
      unsubscribe = () => listener.subscription.unsubscribe();
      const { data, error } = await client.auth.getUser();
      if (!cancelled) setState({ workspaceId, enabled: farmEnabledForWorkspace(data.user?.user_metadata, workspaceId), loading: false, error: error ? 'Could not load Farm setting.' : '' });
    }).catch(() => { if (!cancelled) setState({ workspaceId, enabled: false, loading: false, error: 'Could not load Farm setting.' }); });
    return () => { cancelled = true; unsubscribe?.(); };
  }, [workspaceId]);

  const setEnabled = useCallback(async (enabled: boolean) => {
    if (!workspaceId) throw new Error('Select a workspace first.');
    setSaving(true);
    try {
      const client = await getClientAsync();
      const { data: { user }, error: userError } = await client.auth.getUser();
      if (userError || !user) throw new Error('Sign in to update Farm settings.');
      const previous = user.user_metadata[PREFERENCE_KEY];
      const { error } = await client.auth.updateUser({ data: { [PREFERENCE_KEY]: { ...(previous && typeof previous === 'object' ? previous : {}), [workspaceId]: enabled } } });
      if (error) throw new Error('Could not save Farm setting. Try again.');
      setState({ workspaceId, enabled, loading: false, error: '' });
    } finally { setSaving(false); }
  }, [workspaceId]);

  return { enabled: state.workspaceId === workspaceId && state.enabled, loading: state.workspaceId !== workspaceId || state.loading, error: state.workspaceId === workspaceId ? state.error : '', saving, setEnabled };
}
