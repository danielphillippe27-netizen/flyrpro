'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { RecordingRetention } from './RecordingRetention';
import { Mic, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { audioBudgetSummary, checkedAudioBudget, checkedProviderUsage, providerUsageSummary, type providerLimitStatus } from '@/lib/field-recordings/provider-limits';

type Status = { retentionEnabled?: boolean; deviceAccessConfigured: boolean; transcriptionConfigured: boolean; jevConfigured: boolean; writingConfigured: boolean; processingDispatchConfigured: boolean; processingEnabled: boolean; audioTimelineConfigured: boolean; dailyRequestLimits?: ReturnType<typeof providerLimitStatus>; dailyRequestUsage?: ReturnType<typeof checkedProviderUsage> | null; dailyAudioBudget?: ReturnType<typeof checkedAudioBudget> };
export function PlaudCard({ workspaceId }: { workspaceId?: string | null }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setStatus(null);
    if (!workspaceId) { setLoading(false); setError(null); return; }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/integrations/plaud/status?workspaceId=${encodeURIComponent(workspaceId)}`, { signal: controller.signal, cache: 'no-store' })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to load PLAUD status'); return data as Status; })
      .then(value => { if (value.dailyRequestUsage) value.dailyRequestUsage = checkedProviderUsage(value.dailyRequestUsage); if (value.dailyAudioBudget) value.dailyAudioBudget = checkedAudioBudget(value.dailyAudioBudget); if (!controller.signal.aborted) setStatus(value); })
      .catch(error => { if (!controller.signal.aborted) { setStatus(null); setError(error instanceof Error ? error.message : 'Unable to load status'); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [workspaceId, refresh]);
  return <Card>
    <CardHeader><CardTitle className="flex items-center gap-2"><Mic className="h-5 w-5" />PLAUD NotePin S</CardTitle>
      <CardDescription>Capture field conversations on your phone. Review transcripts, objections and follow-ups in WolfGrid.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      {status?.dailyRequestLimits && <p className="text-sm">{!status.dailyRequestLimits.valid ? 'A daily request limit is invalid. Affected processing is paused.' : !status.dailyRequestLimits.configured ? 'Daily provider request limits are not configured.' : `Daily requests per workspace: PLAUD ${status.dailyRequestLimits.transcribe ?? 'unlimited'}, Jev ${status.dailyRequestLimits.analyze ?? 'unlimited'}, writing ${status.dailyRequestLimits.write ?? 'unlimited'}. Resets at midnight UTC; these are request limits, not a dollar budget.`}</p>}
      {status && <p className="text-sm">{status.dailyRequestUsage && status.dailyRequestLimits ? providerUsageSummary(status.dailyRequestUsage, status.dailyRequestLimits) : 'Daily request usage is unavailable.'}</p>}
      {status && <p className="text-sm">{status.dailyAudioBudget ? audioBudgetSummary(status.dailyAudioBudget) : 'Audio-minute limit status is unavailable.'}</p>}
      {!workspaceId ? <p>Select a workspace to view integration status.</p> : loading ? <p role="status">Checking integration…</p> : error ? <p role="alert" className="text-red-600">{error}</p> : status && <dl className="grid grid-cols-2 gap-2 text-sm">
        {([['Device access', status.deviceAccessConfigured], ['PLAUD transcription', status.transcriptionConfigured], ['Jev decisions', status.jevConfigured], ['Notes and summaries', status.writingConfigured], ['Processing dispatch', status.processingDispatchConfigured], ['Audio timeline mapping', status.audioTimelineConfigured]] as const).map(([label, ready]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd>{ready ? 'Configuration detected' : 'Setup required'}</dd></div>)}
      </dl>}
      {status && !status.processingEnabled && <p role="status" className="text-sm">Recording processing is paused by the server. Queued recordings remain available for processing after it resumes.</p>}
      <p className="text-sm text-muted-foreground">These checks detect server configuration. They do not verify provider access, background processing or hardware behavior.</p>
      {workspaceId && <RecordingRetention workspaceId={workspaceId} enabled={status?.retentionEnabled === true} />}
      <details className="space-y-2 rounded border p-3"><summary className="cursor-pointer text-sm font-medium">Set up live recording and AI</summary>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Obtain <a href="https://docs.plaud.ai/plaud-embedded/overview" target="_blank" rel="noopener noreferrer" className="underline">PLAUD Embedded developer access</a> for WolfGrid and configure device authentication and transcription credentials on the server.</li>
          <li>Obtain a <a href="https://console.typesafe.ai" target="_blank" rel="noopener noreferrer" className="underline">TypeSafe AI account for Jev</a> and configure its server API key. Jev classifies outcomes and objections; the notes provider drafts the prose.</li>
          <li>Configure the notes provider and processing dispatcher. Verify database migrations and private audio storage before uploading field recordings.</li>
          <li>Pair the pin in the mobile app, enable campaign recording, and test start, pause, resume, stop, upload and review. Validate audio timestamp behavior before enabling automatic timeline mapping.</li>
        </ol>
        <p className="text-xs text-muted-foreground">Provider secrets belong in server settings. Never paste them into conversation notes or include them in mobile app builds.</p>
      </details>
      <p className="text-sm text-muted-foreground">Pair and control the pin in the WolfGrid iOS or Android app. Server configuration does not confirm a connected device.</p>
      <div className="flex gap-2"><Button variant="outline" disabled={loading || !workspaceId} onClick={() => setRefresh(value => value + 1)}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button><Button asChild><Link href="/conversations">Review conversations</Link></Button></div>
    </CardContent>
  </Card>;
}
