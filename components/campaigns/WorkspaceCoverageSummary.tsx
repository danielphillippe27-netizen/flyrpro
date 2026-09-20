'use client';
import { useEffect, useState } from 'react';

export type WorkspaceCoverageSnapshot = {
  campaignId: string;
  enabled: boolean;
  homes: Array<{ address_id: string; state: string; campaign_name: string | null; rep_name: string | null; visited_at: string | null }>;
  summary?: { total: number; visited: number; overlap: number; available: number; unmatched: number };
};
export function WorkspaceCoverageSummary({ campaignId, onSnapshot }: { campaignId: string; onSnapshot?: (snapshot: WorkspaceCoverageSnapshot | null) => void }) {
  const [snapshot, setSnapshot] = useState<{ enabled: boolean; summary?: { total: number; visited: number; overlap: number; available: number; unmatched: number } } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setSnapshot(null); setFailed(false);
    let inFlight = false;
    async function refresh() {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        const response = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/coverage`, { signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error('Coverage unavailable');
        const next = await response.json();
        if (!controller.signal.aborted) { setSnapshot(next); onSnapshot?.({ ...next, campaignId }); setFailed(false); }
      } catch { if (!controller.signal.aborted) setFailed(true); }
      finally { inFlight = false; }
    }
    void refresh();
    const timer = setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [campaignId, onSnapshot]);
  if (!snapshot?.enabled || !snapshot.summary) return null;
  const { visited, overlap, available, unmatched } = snapshot.summary;
  return <div role="status" className="absolute bottom-3 left-3 z-20 max-w-[calc(100%-6rem)] rounded-lg border bg-background/95 px-3 py-2 text-xs text-foreground shadow-sm">
    <strong>Team coverage</strong> · {visited} visited elsewhere · {overlap} overlapping · {available} available
    {unmatched > 0 && <span> · {unmatched} unmatched</span>}
    {failed && <div className="text-destructive">Coverage may be out of date. Reconnecting…</div>}
  </div>;
}
