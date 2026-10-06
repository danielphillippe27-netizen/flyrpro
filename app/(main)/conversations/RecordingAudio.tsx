'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export default function RecordingAudio({ recordingId, chunkId }: { recordingId: string; chunkId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function load() {
    if (loading) return;
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/field-recordings/${recordingId}/chunks/${chunkId}/playback`, { cache: 'no-store' });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || 'Unable to load audio');
      setUrl(value.url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load audio'); }
    finally { setLoading(false); }
  }
  return <div className="space-y-2">
    <Button variant="outline" disabled={loading} onClick={() => void load()}>{loading ? 'Loading audio…' : url ? 'Refresh audio access' : 'Load recording audio'}</Button>
    {url && <audio controls preload="none" src={url} className="w-full" onError={() => { setUrl(null); setError('Audio access expired or unavailable. Load it again.'); }}>Your browser does not support audio playback.</audio>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
  </div>;
}
