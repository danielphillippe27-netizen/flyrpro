'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

export function ReconciliationActions({
  runId,
  decisionId,
  action,
  risky = false,
}: {
  runId: string;
  decisionId?: string;
  action: 'approve' | 'reject' | 'rollback' | 'rollback_run';
  risky?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if ((risky || action === 'rollback_run') && !window.confirm(
      action === 'rollback_run'
        ? 'Roll back every applied decision in this run?'
        : 'Apply this footprint hide or synthetic-address decision?'
    )) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/map-reconciliation/${runId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          decision_id: decisionId,
          confirm: risky || action === 'rollback_run',
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Action failed');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inline-flex flex-col gap-1">
      <Button
        type="button"
        size="sm"
        variant={action === 'reject' || action.startsWith('rollback') ? 'outline' : 'default'}
        disabled={busy}
        onClick={submit}
      >
        {busy ? 'Working…' : action.replaceAll('_', ' ')}
      </Button>
      {error ? <span className="max-w-48 text-xs text-destructive">{error}</span> : null}
    </div>
  );
}

export function ReconciliationBatchActions({
  runId,
  decisionIds,
  action,
  label,
  risky = false,
}: {
  runId: string;
  decisionIds: string[];
  action: 'approve' | 'reject';
  label: string;
  risky?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (decisionIds.length === 0) return null;

  const submit = async () => {
    if (risky && !window.confirm(
      `Apply ${decisionIds.length} filtered footprint-hide or synthetic-address decisions?`
    )) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/map-reconciliation/${runId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          decision_ids: decisionIds,
          confirm: risky,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Batch action failed');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Batch action failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inline-flex flex-col gap-1">
      <Button
        type="button"
        size="sm"
        variant={action === 'reject' ? 'outline' : 'default'}
        disabled={busy}
        onClick={submit}
      >
        {busy ? 'Working…' : `${label} (${decisionIds.length})`}
      </Button>
      {error ? <span className="max-w-64 text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
