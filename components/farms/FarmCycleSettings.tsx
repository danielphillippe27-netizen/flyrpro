'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Farm, FarmTouchAddress } from '@/types/database';
import type { EnrichedFarmTouch } from '@/lib/farms/analytics';
import { cycleDateError, type FarmCycle } from '@/lib/farms/cycles';
import { localPlanDate } from '@/lib/farms/touch-plan';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import styles from './FarmSettings.module.css';

function EndDateEditor({ cycle, onSaved, onDirtyChange }: { cycle: FarmCycle; onSaved: (cycle: FarmCycle) => void; onDirtyChange?: (dirty: boolean) => void }) {
  const [end, setEnd] = useState(cycle.ends_on ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => { onDirtyChange?.(saving || end !== (cycle.ends_on ?? '')); }, [cycle.ends_on, end, onDirtyChange, saving]);
  const inputId = `cycle-end-${cycle.cycle_number}`;
  useEffect(() => { setEnd(cycle.ends_on ?? ''); setError(''); }, [cycle.ends_on, cycle.updated_at]);
  async function save() {
    const invalid = cycleDateError(cycle.started_on, end);
    if (invalid) { setError(invalid); return; }
    setSaving(true); setError(''); setMessage('');
    try {
      const { data, error: failure } = await createClient().rpc('set_farm_cycle_end_date', {
        p_farm_id: cycle.farm_id, p_cycle_number: cycle.cycle_number,
        p_ends_on: end || null, p_expected_updated_at: cycle.updated_at,
      });
      if (failure) throw new Error(failure.message);
      onSaved(data as FarmCycle);
      setMessage('End date saved.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save end date.'); }
    finally { setSaving(false); }
  }
  return <div className="space-y-2">
    <Label htmlFor={inputId}>Cycle {cycle.cycle_number} end date</Label>
    <div className="flex flex-wrap items-center gap-2">
      <Input id={inputId} type="date" min={cycle.started_on ?? undefined} value={end}
        disabled={saving} className="w-auto" onChange={event => { setEnd(event.target.value); setMessage(''); setError(''); }} />
      <Button type="button" variant="outline" disabled={saving || end === (cycle.ends_on ?? '')} onClick={() => void save()}>
        {saving ? 'Saving…' : 'Save end date'}
      </Button>
    </div>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}
  </div>;
}

export function FarmCycleSettings({ farm, touches, outcomes, onChanged }: {
  farm: Farm; touches: EnrichedFarmTouch[]; outcomes: FarmTouchAddress[]; onChanged: () => Promise<void>;
}) {
  const [cycles, setCycles] = useState<FarmCycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [currentDateDirty, setCurrentDateDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [start, setStart] = useState(localPlanDate());
  const [end, setEnd] = useState('');
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
        if (!cancelled) setError(failure instanceof Error ? failure.message : 'Could not load cycles.');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [farm.id, active, reload]);
  const current = cycles.find(cycle => cycle.cycle_number === active);
  const history = cycles.filter(cycle => cycle.cycle_number < (active ?? 1));
  function onSaved(updated: FarmCycle) {
    setCycles(previous => previous.map(cycle => cycle.cycle_number === updated.cycle_number ? updated : cycle));
  }
  function coverage(cycle: number) {
    const ids = new Set(touches.filter(touch => touch.resolvedCycleNumber === cycle).map(touch => touch.id));
    return new Set(outcomes.filter(outcome => ids.has(outcome.farm_touch_id) && outcome.status !== 'none').map(outcome => outcome.farm_address_id)).size;
  }
  async function advance() {
    const invalid = !start ? 'Choose a start date.' : cycleDateError(current?.started_on ?? null, start) || cycleDateError(start, end);
    if (invalid) { setError(invalid); return; }
    setSaving(true); setError('');
    try {
      const { error: failure } = await createClient().rpc('advance_farm_cycle', {
        p_farm_id: farm.id, p_expected_cycle: active, p_started_on: start, p_ends_on: end || null,
      });
      if (failure) throw new Error(failure.message);
      setConfirming(false);
      await onChanged();
      setReload(value => value + 1);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not start the next cycle.'); }
    finally { setSaving(false); }
  }
  return <section className={styles.section} aria-labelledby="farm-cycles-heading">
    <h3 id="farm-cycles-heading">Cycles</h3>
    <p className={styles.description}>One active round for this farm. Sessions stay in that round until you start the next cycle.</p>
    {loading ? <p role="status">Loading cycles…</p> : current ? <>
      <p className="font-medium">Current cycle: Cycle {active}</p>
      <p className="text-sm text-muted-foreground">Started {current.started_on ?? 'date not recorded'} · {coverage(current.cycle_number).toLocaleString()} homes reached</p>
      <EndDateEditor key={`${farm.id}:${current.cycle_number}`} cycle={current} onSaved={onSaved} onDirtyChange={setCurrentDateDirty} />
      <p className="text-xs text-muted-foreground">The end date is editable and optional. Reaching it does not automatically start another cycle.</p>
      <Button type="button" variant="outline" disabled={currentDateDirty} onClick={() => { setStart(localPlanDate()); setEnd(''); setError(''); setConfirming(true); }}>Start Cycle {(active ?? 1) + 1}</Button>
      {currentDateDirty ? <p className="text-xs text-muted-foreground">Save the current end date before starting the next cycle.</p> : null}
      {history.length > 0 ? <details className="space-y-4">
        <summary className="cursor-pointer text-sm font-medium">Cycle history</summary>
        {history.map(cycle => <div key={cycle.cycle_number} className="space-y-2 rounded-lg border p-3">
          <p className="font-medium">Cycle {cycle.cycle_number}</p>
          <p className="text-sm text-muted-foreground">Started {cycle.started_on ?? 'date not recorded'} · {coverage(cycle.cycle_number).toLocaleString()} homes reached · {touches.filter(touch => touch.resolvedCycleNumber === cycle.cycle_number).length} sessions</p>
          <EndDateEditor cycle={cycle} onSaved={onSaved} />
        </div>)}
      </details> : null}
    </> : <p className="text-sm">Cycle settings are unavailable. Refresh after the cycle update is installed.</p>}
    {error && !confirming ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {!loading ? <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={() => { setReload(value => value + 1); void onChanged(); }}>Refresh cycles</Button> : null}
    <Dialog open={confirming} onOpenChange={open => { if (!saving) setConfirming(open); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Start Cycle {(active ?? 1) + 1}?</DialogTitle>
          <DialogDescription>Cycle {active} will move to history. Coverage starts fresh. Existing sessions, contacts, notes, leads, follow-ups, and do-not-knock instructions are kept. Save any end-date changes before continuing.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2"><Label htmlFor="next-cycle-start">New cycle start date</Label>
          <Input id="next-cycle-start" type="date" min={current?.started_on ?? undefined} value={start} disabled={saving} onChange={event => setStart(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="next-cycle-end">New cycle end date (optional)</Label>
          <Input id="next-cycle-end" type="date" min={start} value={end} disabled={saving} onChange={event => setEnd(event.target.value)} /></div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter><Button variant="outline" disabled={saving} onClick={() => setConfirming(false)}>Cancel</Button>
          <Button disabled={saving} onClick={() => void advance()}>{saving ? 'Starting…' : `Start Cycle ${(active ?? 1) + 1}`}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
