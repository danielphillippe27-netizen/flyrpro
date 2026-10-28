'use client';

import { useState } from 'react';
import type { DurhamPlaceMatch } from '@/lib/farms/durhamPlaces';

type Result = { farmAddressCount: number; addressesInDurham: number; matchedAddressCount: number; matches: DurhamPlaceMatch[]; excluded: { address_id: string; address_data: { formatted: string }; places: { name: string }[] }[] };

export function DurhamCommercialReview({ farmId }: { farmId: string }) {
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  async function review() {
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/farms/${encodeURIComponent(farmId)}/commercial-review`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not check places');
      setResult(data);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not check places'); }
    finally { setLoading(false); }
  }
  async function restore(addressId: string) {
    setRestoring(addressId); setError('');
    try {
      const response = await fetch(`/api/farms/${encodeURIComponent(farmId)}/commercial-review/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ addressId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not restore address');
      window.location.reload();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not restore address'); setRestoring(null); }
  }
  return <section className="rounded-2xl border border-neutral-700 p-5 space-y-3" aria-label="Durham business review">
    <h2 className="text-lg font-semibold">Review possible businesses</h2>
    <p className="text-sm text-neutral-400">Review addresses excluded by the Durham business filter and restore homes or mixed-use addresses.</p>
    <button type="button" onClick={review} disabled={loading} className="rounded-lg bg-neutral-200 px-4 py-2 text-sm font-medium text-black disabled:opacity-50">{loading ? 'Checking…' : 'Review business matches'}</button>
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    {result && <div className="space-y-2 text-sm">
      <p>{result.excluded.length} excluded addresses. {result.matchedAddressCount} included addresses also match a place; {result.addressesInDurham} of {result.farmAddressCount} included addresses were checked in Durham.</p>
      <div className="max-h-80 overflow-y-auto divide-y divide-neutral-700">{result.excluded.map(row => <div key={row.address_id} className="flex items-center justify-between gap-3 py-2"><div><strong>{row.address_data.formatted}</strong><p className="text-neutral-400">{row.places.map(place => place.name).join(', ')}</p></div><button type="button" disabled={!!restoring} onClick={() => void restore(row.address_id)} className="rounded border border-neutral-500 px-3 py-1 disabled:opacity-50">{restoring === row.address_id ? 'Restoring…' : 'Restore'}</button></div>)}</div>
      <div className="max-h-80 overflow-y-auto divide-y divide-neutral-700">{result.matches.map(match => <div key={match.addressId} className="py-2"><strong>{match.address}</strong><p className="text-neutral-400">{match.places.map(place => place.name).join(', ')}</p></div>)}</div>
    </div>}
  </section>;
}
