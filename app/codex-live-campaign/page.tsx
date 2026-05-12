'use client';

import { useMemo, useState } from 'react';

const polygon = {
  type: 'Polygon' as const,
  coordinates: [[
    [-79.3162, 43.6782],
    [-79.3128, 43.6782],
    [-79.3128, 43.6811],
    [-79.3162, 43.6811],
    [-79.3162, 43.6782],
  ]],
};

const bbox = [-79.3162, 43.6782, -79.3128, 43.6811];

export default function CodexLiveCampaignPage() {
  const [status, setStatus] = useState('ready');
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [output, setOutput] = useState<unknown>(null);
  const name = useMemo(
    () => `Codex parcel live ${new Date().toISOString().replace(/[:.]/g, '-')}`,
    []
  );

  async function runLiveCampaign() {
    setStatus('creating');
    setOutput(null);

    const createResponse = await fetch('/api/campaigns', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        type: 'prospecting',
        address_source: 'map',
        bbox,
        territory_boundary: polygon,
      }),
    });
    const created = await createResponse.json();
    if (!createResponse.ok) {
      setStatus('create failed');
      setOutput(created);
      return;
    }

    setCampaignId(created.id);
    setStatus('provisioning');

    const provisionResponse = await fetch('/api/campaigns/provision', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id: created.id }),
    });
    const provisioned = await provisionResponse.json();
    setStatus(provisionResponse.ok ? 'accepted' : 'provision failed');
    setOutput({ created, provisioned });
  }

  return (
    <main style={{ padding: 32, fontFamily: 'system-ui, sans-serif', maxWidth: 900 }}>
      <h1>Codex Live Campaign</h1>
      <p>Creates one small Toronto parcel-supported campaign through the real authenticated app APIs.</p>
      <button
        onClick={runLiveCampaign}
        disabled={status === 'creating' || status === 'provisioning'}
        style={{ padding: '10px 14px', border: '1px solid #111', borderRadius: 6 }}
      >
        Run live campaign
      </button>
      <p>Status: {status}</p>
      {campaignId ? (
        <p>
          Campaign:{' '}
          <a href={`/campaigns/${campaignId}`}>{campaignId}</a>
        </p>
      ) : null}
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {output ? JSON.stringify(output, null, 2) : ''}
      </pre>
    </main>
  );
}
