'use client';

import { useEffect, useState } from 'react';
import { StatCard } from './StatCard';

export function BusinessCardOpenedStat({ workspaceId, userId, scope }: {
  workspaceId: string | null;
  userId: string;
  scope: 'self' | 'team';
}) {
  const key = `${workspaceId}:${userId}:${scope}`;
  const [result, setResult] = useState<{ key: string; value: number | 'Unavailable' } | null>(null);
  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try {
        const response = await fetch(`/api/cards/stats?workspaceId=${encodeURIComponent(workspaceId)}&scope=${scope}`, {
          credentials: 'include', signal: controller.signal,
        });
        if (!response.ok) throw new Error('Unable to load card opens');
        const data = await response.json();
        if (!Number.isSafeInteger(data.opened) || data.opened < 0) throw new Error('Invalid card count');
        if (!controller.signal.aborted) setResult({ key, value: data.opened });
      } catch {
        if (!controller.signal.aborted) setResult({ key, value: 'Unavailable' });
      } finally { pending = false; }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 15000);
    const visible = () => void refresh();
    document.addEventListener('visibilitychange', visible);
    return () => { controller.abort(); clearInterval(interval); document.removeEventListener('visibilitychange', visible); };
  }, [workspaceId, scope, key]);
  return <StatCard label="Business Cards Opened" value={!workspaceId ? 'Select a workspace' : result?.key === key ? result.value : '…'} />;
}
