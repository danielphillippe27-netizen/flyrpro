'use client';

import { useEffect, useState } from 'react';
import { MailOpen, Send } from 'lucide-react';

type Stats = { farmId: string; status: 'ready'; sent: number; opened: number } | { farmId: string; status: 'error' };
export function FarmBusinessCardMetrics({ farmId }: { farmId: string }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    async function refresh() {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try {
        const response = await fetch(`/api/farms/${encodeURIComponent(farmId)}/card-stats`, { signal: controller.signal, credentials: 'include' });
        const data = await response.json();
        if (!response.ok || !Number.isSafeInteger(data.sent) || data.sent < 0 || !Number.isSafeInteger(data.opened) || data.opened < 0) throw Error('Unable to load card totals');
        if (!controller.signal.aborted) setStats({ farmId, status: 'ready', sent: data.sent, opened: data.opened });
      } catch {
        if (!controller.signal.aborted) setStats({ farmId, status: 'error' });
      } finally { pending = false; }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    const focus = () => void refresh();
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [farmId, retry]);
  const current = stats?.farmId === farmId ? stats : null;
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2" aria-label="Digital business card analytics">
    {([{ key: 'sent', title: 'Business cards sent', icon: Send, description: 'Confirmed sends · all time' }, { key: 'opened', title: 'Business cards opened', icon: MailOpen, description: 'Qualified card visits · all time' }] as const).map(({ key, title, icon: Icon, description }) => <div key={key} className="rounded-xl border border-border bg-card p-4">
      <p className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><Icon className="h-4 w-4" aria-hidden="true" />{title}</p>
      <div className="mt-4 text-2xl font-semibold tabular-nums text-foreground" aria-live="polite">{current?.status === 'ready' ? current[key].toLocaleString() : current?.status === 'error' ? '—' : '…'}</div>
      <p className="mt-2 text-sm text-muted-foreground">{current?.status === 'error' ? 'Card analytics unavailable' : description}</p>
      {current?.status === 'error' && <button type="button" className="mt-2 text-xs underline" onClick={() => setRetry(value => value + 1)}>Retry {key === 'sent' ? 'send' : 'open'} totals</button>}
    </div>)}
  </div>;
}
