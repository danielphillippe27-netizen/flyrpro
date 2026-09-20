'use client';

import { useEffect, useState } from 'react';
import { useWorkspace } from '@/lib/workspace-context';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';

type Settings = { enabled: boolean; canManage: boolean };

export function WorkspaceCoverageSettings() {
  const { currentWorkspaceId, membershipsByWorkspaceId } = useWorkspace();
  const role = currentWorkspaceId ? membershipsByWorkspaceId[currentWorkspaceId] : null;
  if (role !== 'owner' && role !== 'admin') return null;
  // Remount on a workspace switch, including while a save is in flight.
  return currentWorkspaceId ? <CoverageSettings key={currentWorkspaceId} workspaceId={currentWorkspaceId} /> : null;
}

function CoverageSettings({ workspaceId }: { workspaceId: string }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/workspace/coverage?workspaceId=${encodeURIComponent(workspaceId)}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error('Shared coverage settings are unavailable.');
        return response.json() as Promise<Settings>;
      }).then(setSettings).catch(err => { if (!controller.signal.aborted) setError(err.message); });
    return () => controller.abort();
  }, [workspaceId]);
  async function save(enabled: boolean) {
    if (!settings?.canManage || saving) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch('/api/workspace/coverage', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, enabled }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Could not save shared coverage.');
      setSettings(payload);
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not save shared coverage.'); }
    finally { setSaving(false); }
  }
  // Members have no toggle, even if they created one of the campaigns.
  if (settings && !settings.canManage) return null;
  return <Card>
    <CardHeader><CardTitle>Shared team coverage</CardTitle><CardDescription>
      Prevent repeat visits to the same home across your team’s campaigns. Managers can override a visited home with a reason.
    </CardDescription></CardHeader>
    <CardContent className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="workspace-home-coverage">Prevent duplicate visits</Label>
        <Switch id="workspace-home-coverage" checked={settings?.enabled ?? false} disabled={!settings?.canManage || saving} onCheckedChange={save} />
      </div>
      <p className="text-sm text-muted-foreground">Off by default. Applies only to this workspace. Turning it off keeps visit history.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </CardContent>
  </Card>;
}
