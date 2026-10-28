'use client';

import { useState } from 'react';
import { useFarmEnabled } from '@/lib/hooks/useFarmEnabled';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';

export function FarmSettingsCard({ workspaceId }: { workspaceId: string | null }) {
  const { enabled, loading, saving, error: loadError, setEnabled } = useFarmEnabled(workspaceId);
  const [error, setError] = useState('');
  return <Card>
    <CardHeader><CardTitle>Farm</CardTitle><CardDescription>Repeat visits and outreach in an area you work regularly.</CardDescription></CardHeader>
    <CardContent className="space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div><label htmlFor="show-farm" className="font-medium">Show Farm</label><p className="text-sm text-muted-foreground">Show farms in campaigns, campaign creation, and linked session details in this workspace. Saved for your account.</p></div>
        <Switch id="show-farm" checked={enabled} disabled={loading || saving || !workspaceId || !!loadError} onCheckedChange={checked => { setError(''); void setEnabled(checked).catch(reason => setError(reason instanceof Error ? reason.message : 'Could not save Farm setting.')); }} />
      </div>
      {(error || loadError) && <p role="alert" className="text-sm text-destructive">{error || loadError}</p>}
    </CardContent>
  </Card>;
}
