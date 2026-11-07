'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Farm, FarmTouchAddress } from '@/types/database';
import type { EnrichedFarmTouch } from '@/lib/farms/analytics';
import type { FarmCycle } from '@/lib/farms/cycles';
import { localPlanDate } from '@/lib/farms/touch-plan';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import styles from './FarmSettings.module.css';

export function FarmCycleSettings({ farm, touches, outcomes, onChanged }: {
  farm: Farm; touches: EnrichedFarmTouch[]; outcomes: FarmTouchAddress[]; onChanged: () => Promise<void>;
}) {
  const [cycles, setCycles] = useState<FarmCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [action, setAction] = useState<'start' | 'undo' | null>(null);
  const [saving, setSaving] = useState(false);
  const active = farm.active_cycle_number;
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    void (async () => {
      try {
        const { data, error: failure } = await createClient().from('farm_cycles').select('*')
          .eq('farm_id', farm.id).order('cycle_number', { ascending: false });
        if (failure) throw new Error(failure.message);
        if (!cancelled) setCycles(data as FarmCycle[]);
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : 'Could not load round history.');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [farm.id, active, reload]);
  const current = cycles.find(cycle => cycle.cycle_number === active);
  const history = cycles.filter(cycle => cycle.cycle_number < (active ?? 1));
  function coverage(cycle: number) {
    const ids = new Set(touches.filter(touch => touch.resolvedCycleNumber === cycle).map(touch => touch.id));
    return new Set(outcomes.filter(outcome => ids.has(outcome.farm_touch_id) && outcome.status !== 'none').map(outcome => outcome.farm_address_id)).size;
  }
  async function performAction() {
    if (!navigator.onLine) { setError('Connect to the internet before changing rounds.'); return; }
    setSaving(true); setError('');
    try {
      const { error: failure } = action === 'undo'
        ? await createClient().rpc('undo_farm_round', { p_farm_id: farm.id, p_expected_cycle: active })
        : await createClient().rpc('advance_farm_cycle', {
          p_farm_id: farm.id, p_expected_cycle: active, p_started_on: localPlanDate(), p_ends_on: null,
        });
      if (failure) throw new Error(failure.message);
      setAction(null);
      await onChanged();
      setReload(value => value + 1);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not change rounds. Refresh and try again.'); }
    finally { setSaving(false); }
  }
  return <section className={styles.section} aria-labelledby="farm-round-heading">
    <h3 id="farm-round-heading">Round progress</h3>
    <p className={styles.description}>Your home colours stay as you left them. Starting or ending a session never resets progress.</p>
    {loading ? <p role="status">Loading round history…</p> : current ? <>
      <p className="text-sm text-muted-foreground">Started {current.started_on ?? 'date not recorded'} · {coverage(current.cycle_number).toLocaleString()} homes reached</p>
      <Button type="button" variant="outline" disabled={saving} onClick={() => { setError(''); setAction('start'); }}>Start a new round</Button>
      {(active ?? 1) > 1 && coverage(active!) === 0 ? <Button type="button" variant="ghost" disabled={saving} onClick={() => { setError(''); setAction('undo'); }}>Undo new round</Button> : null}
      {history.length > 0 ? <details className="space-y-4">
        <summary className="cursor-pointer text-sm font-medium">History</summary>
        {history.map(cycle => <div key={cycle.cycle_number} className="space-y-2 rounded-lg border p-3">
          <p className="font-medium">Round {cycle.cycle_number}</p>
          <p className="text-sm text-muted-foreground">{cycle.started_on ?? 'Unknown start'} – {cycle.ends_on ?? cycle.closed_at?.slice(0, 10) ?? 'Open'} · {coverage(cycle.cycle_number).toLocaleString()} homes reached · {touches.filter(touch => touch.resolvedCycleNumber === cycle.cycle_number && touch.status === 'completed').length} completed visits</p>
        </div>)}
      </details> : null}
    </> : <p role="alert">Saved round unavailable. Refresh before starting a new session.</p>}
    {error && !action ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {!loading ? <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => { setReload(value => value + 1); void onChanged(); }}>Refresh</Button> : null}
    <Dialog open={action !== null} onOpenChange={open => { if (!saving && !open) setAction(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{action === 'undo' ? 'Restore the previous round?' : 'Start a new round?'}</DialogTitle>
          <DialogDescription>{action === 'undo'
            ? 'Restore the previous home colours and progress. This is only available before any activity in the new round.'
            : 'Visit progress and coverage colours start fresh today. Contacts, leads, appointments, notes, follow-ups, do-not-knock instructions, and previous visits are kept. Finish any open Farm session and sync your devices first.'}</DialogDescription>
        </DialogHeader>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter><Button variant="outline" disabled={saving} onClick={() => setAction(null)}>Cancel</Button>
          <Button disabled={saving} onClick={() => void performAction()}>{saving ? 'Saving…' : action === 'undo' ? 'Restore previous round' : 'Start new round'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
