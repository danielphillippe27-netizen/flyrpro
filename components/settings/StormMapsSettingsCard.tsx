'use client';

import { useEffect, useState } from 'react';
import { CloudLightning, Loader2, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type StormMapsSettingsResponse = {
  addon?: { isActive?: boolean; priceLabel?: string; status?: string };
  canManage?: boolean;
  betaAvailable?: boolean;
  error?: string;
};

export function StormMapsSettingsCard({ workspaceId }: { workspaceId: string | null }) {
  const [data, setData] = useState<StormMapsSettingsResponse | null>(null);
  const [loading, setLoading] = useState(Boolean(workspaceId));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!workspaceId) {
      setData(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    setMessage(null);
    fetch(`/api/storm-maps/settings?workspaceId=${encodeURIComponent(workspaceId)}`, {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as StormMapsSettingsResponse;
        if (!response.ok) throw new Error(payload.error || 'Could not load Storm Maps settings.');
        if (!cancelled) setData(payload);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (!cancelled) setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not load Storm Maps settings.' });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [workspaceId]);

  const updateAddon = async (enabled: boolean) => {
    if (!workspaceId || !data?.canManage) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch('/api/storm-maps/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ workspaceId, enabled }),
      });
      const payload = (await response.json().catch(() => ({}))) as StormMapsSettingsResponse;
      if (!response.ok) throw new Error(payload.error || 'Could not update Storm Maps.');
      setData(payload);
      setMessage({ type: 'success', text: enabled ? 'Storm Maps Beta is enabled for your workspace.' : 'Storm Maps Beta is disabled.' });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Could not update Storm Maps.' });
    } finally {
      setSaving(false);
    }
  };

  const active = data?.addon?.isActive === true;

  return (
    <Card className="overflow-hidden border-cyan-200/70 bg-gradient-to-br from-white via-cyan-50/40 to-violet-50/60 dark:border-cyan-900/60 dark:from-card dark:via-cyan-950/20 dark:to-violet-950/20">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-violet-600 text-white shadow-lg shadow-cyan-500/20">
                <CloudLightning className="h-5 w-5" />
              </span>
              <CardTitle>Storm Maps</CardTitle>
              <Badge className="border-0 bg-gradient-to-r from-cyan-500 to-violet-600 text-[10px] tracking-[0.16em] text-white">BETA</Badge>
            </div>
            <CardDescription>
              Live radar, official alerts, storm reports, and forecast overlays while building campaign territories.
            </CardDescription>
          </div>
          <div className="rounded-xl border border-cyan-200 bg-white/80 px-3 py-2 text-right shadow-sm dark:border-cyan-900 dark:bg-background/70">
            <p className="text-sm font-semibold text-foreground">$0</p>
            <p className="text-[11px] text-muted-foreground">during Beta</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {message ? (
          <p className={`rounded-lg border px-3 py-2 text-sm ${message.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300' : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'}`}>
            {message.text}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-cyan-600" />
              <p className="text-sm font-medium text-foreground">Workspace add-on</p>
              <Badge variant={active ? 'default' : 'outline'} className={active ? 'bg-emerald-600 hover:bg-emerald-600' : ''}>
                {loading ? 'Loading' : active ? 'Enabled' : 'Not enabled'}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {data?.betaAvailable === false
                ? 'Beta activation is paused until the weather providers are fully configured.'
                : data?.canManage
                  ? 'Owners and admins can change this for every workspace member.'
                  : 'Ask a workspace owner or admin to change this add-on.'}
            </p>
          </div>
          <Button
            type="button"
            variant={active ? 'outline' : 'default'}
            onClick={() => void updateAddon(!active)}
            disabled={loading || saving || !workspaceId || !data?.canManage || data?.betaAvailable === false}
            className={!active ? 'bg-gradient-to-r from-cyan-600 to-violet-600 text-white hover:from-cyan-700 hover:to-violet-700' : ''}
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {active ? 'Disable' : 'Enable free add-on'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
