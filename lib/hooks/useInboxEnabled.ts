'use client';

import { useEffect, useState } from 'react';
import { getClientAsync } from '@/lib/supabase/client';

export function useInboxEnabled() {
  const [enabled, setValue] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    void getClientAsync().then(async client => {
      if (cancelled) return;
      const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
        if (!cancelled) setValue(!!session?.user && session.user.user_metadata.inbox_enabled !== false);
      });
      unsubscribe = () => listener.subscription.unsubscribe();
      const { data, error } = await client.auth.getUser();
      if (cancelled) return;
      setValue(!!data.user && data.user.user_metadata.inbox_enabled !== false);
      if (error) setError('Could not load Inbox setting.');
      setLoading(false);
    }).catch(() => {
      if (!cancelled) { setError('Could not load Inbox setting.'); setLoading(false); }
    });
    return () => { cancelled = true; unsubscribe?.(); };
  }, []);

  async function setEnabled(value: boolean) {
    setSaving(true);
    setError('');
    try {
      const client = await getClientAsync();
      const { error } = await client.auth.updateUser({ data: { inbox_enabled: value } });
      if (error) throw error;
      setValue(value);
    } catch {
      setError('Could not save Inbox setting. Try again.');
    } finally { setSaving(false); }
  }
  return { enabled, loading, saving, error, setEnabled };
}
