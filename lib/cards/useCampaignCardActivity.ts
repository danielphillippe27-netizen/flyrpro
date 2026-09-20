'use client';

import { useEffect, useState } from 'react';
import type { AddressCardEngagement, CardActivityTotals } from './campaign-engagement';

type ActivityState = {
  key: string;
  totals?: CardActivityTotals;
  engagement: AddressCardEngagement[];
  status: 'loading' | 'error' | 'ready';
};

export function useCampaignCardActivity(workspaceId: string | null | undefined, campaignId: string) {
  const key = workspaceId ? `${workspaceId}:${campaignId}` : '';
  const [state, setState] = useState<ActivityState>({ key: '', engagement: [], status: 'loading' });
  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try {
        const response = await fetch(`/api/cards/campaign-engagement?workspaceId=${workspaceId}&campaignId=${campaignId}`, {
          credentials: 'include', signal: controller.signal,
        });
        if (!response.ok) throw new Error('Unable to load business-card activity');
        const payload: { engagement: AddressCardEngagement[]; totals: CardActivityTotals } = await response.json();
        if (!controller.signal.aborted) setState({ key, engagement: payload.engagement, totals: payload.totals, status: 'ready' });
      } catch {
        if (!controller.signal.aborted) setState({ key, engagement: [], status: 'error' });
      } finally {
        pending = false;
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 15000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      controller.abort();
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [workspaceId, campaignId, key]);
  // Never display the previous workspace or campaign while the next request loads.
  return state.key === key && key ? state : { key, engagement: [], totals: undefined, status: 'loading' as const };
}
