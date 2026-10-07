'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Sparkles } from 'lucide-react';

type Fact = { value: string; sourceUrl: string };
type Result = { name: string; area: string; notes: string; website: Fact | null; email: Fact | null; phone: Fact | null; owner: Fact | null; address: Fact | null };
const fields = ['website', 'email', 'phone', 'owner', 'address'] as const;
export default function BusinessResearchPanel({ workspaceId }: { workspaceId?: string | null }) {
  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState(false);
  const generation = useRef(0);
  useEffect(() => { const counter = generation; counter.current++; setResult(null); setMessage(''); setBusy(false); setSaved(false); return () => { counter.current++; }; }, [workspaceId]);
  async function run(save: boolean) {
    const current = ++generation.current;
    setBusy(true); setMessage('');
    if (!save) { setResult(null); setSaved(false); }
    try {
      const response = await fetch('/api/salesperson/business-research', {
        method: save ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: workspaceId ?? undefined, ...(save ? { result } : { name, area }) }),
      });
      const payload = await response.json();
      if (generation.current !== current) return;
      if (!response.ok) throw new Error(payload.error || 'Lookup failed.');
      if (save) { setMessage(payload.message); setSaved(true); }
      else setResult(payload.result);
    } catch (error) { if (generation.current === current) setMessage(error instanceof Error ? error.message : 'Lookup failed.'); }
    finally { if (generation.current === current) setBusy(false); }
  }
  function search(event: FormEvent) { event.preventDefault(); void run(false); }
  return <section className="space-y-4 rounded-md border border-border bg-card p-4 shadow-sm">
    <div><h2 className="flex items-center gap-2 text-base font-semibold"><Sparkles className="h-4 w-4" />Research a business with AI</h2>
      <p className="mt-1 text-sm text-muted-foreground">Enter a business name and area to find public contact details and, when listed, the owner. Review the sources before adding a lead.</p></div>
    <form onSubmit={search} className="grid items-end gap-3 md:grid-cols-[1fr_1fr_auto]">
      <div className="space-y-2"><Label htmlFor="business-research-name">Business name</Label><Input id="business-research-name" required minLength={2} maxLength={180} value={name} disabled={busy} onChange={e => setName(e.target.value)} placeholder="e.g. HomeRoofer" /></div>
      <div className="space-y-2"><Label htmlFor="business-research-area">Area</Label><Input id="business-research-area" required minLength={2} maxLength={100} value={area} disabled={busy} onChange={e => setArea(e.target.value)} placeholder="e.g. Richmond Hill, Ontario" /></div>
      <Button disabled={busy || !name.trim() || !area.trim()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Research business</Button>
    </form>
    {result && <div className="space-y-3 rounded-md border p-3">
      <h3 className="font-medium">{result.name} · {result.area}</h3><p className="text-sm text-muted-foreground">{result.notes}</p>
      <div className="grid gap-3 md:grid-cols-2">{fields.map(field => <div key={field} className="space-y-1">
        <Label htmlFor={`business-result-${field}`} className="capitalize">{field === 'owner' ? 'Publicly listed owner' : field}</Label>
        <Input id={`business-result-${field}`} value={result[field]?.value ?? ''} disabled={busy || saved || !result[field]} placeholder="Not found in public sources" onChange={e => setResult({ ...result, [field]: { ...result[field]!, value: e.target.value } })} />
        {result[field] && <a className="text-xs text-primary underline" href={result[field]!.sourceUrl} target="_blank" rel="noopener noreferrer">View source</a>}
      </div>)}</div>
      <Button type="button" onClick={() => void run(true)} disabled={busy || saved || !fields.some(field => result[field]?.value)}>{saved ? 'Saved' : 'Add to my leads'}</Button>
    </div>}
    <p role="status" aria-live="polite" className="text-sm">{message || (busy ? 'Working… Research can take about a minute.' : '')}</p>
  </section>;
}
