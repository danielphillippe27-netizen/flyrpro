'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { REALTOR_CA_SENDERS } from '@/lib/email/realtor-ca';

type RouteStatus = {
  address: string | null;
  available: boolean;
  verificationCode?: string | null;
};

async function requestAddress(workspaceId: string, method: string, signal?: AbortSignal): Promise<RouteStatus> {
  const response = await fetch(`/api/integrations/realtor-ca?workspaceId=${encodeURIComponent(workspaceId)}`, {
    method,
    signal,
    cache: 'no-store',
  });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Could not load REALTOR.ca forwarding.');
  }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not update REALTOR.ca forwarding.');
  return data;
}

export function RealtorCaIntegrationCard({ workspaceId }: { workspaceId: string }) {
  const [status, setStatus] = useState<RouteStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [checkedForCode, setCheckedForCode] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    requestAddress(workspaceId, 'GET', controller.signal)
      .then(setStatus)
      .catch((error: Error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [workspaceId]);

  async function update(method: string) {
    setBusy(true);
    setError('');
    try {
      const nextStatus = await requestAddress(workspaceId, method);
      setStatus(nextStatus);
      setCheckedForCode(method === 'GET');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not update forwarding.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>REALTOR.ca</CardTitle>
        <CardDescription>
          Turn forwarded inquiries into Contacts tagged REALTOR.ca Lead.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!status && error && <Button variant="outline" disabled={busy} onClick={() => update('GET')}>Retry</Button>}
        {status && !status.available && <p className="text-sm text-muted-foreground">Inbound email is unavailable.</p>}
        {status?.available && !status.address && (
          <Button disabled={busy} onClick={() => update('POST')}>Create forwarding address</Button>
        )}
        {status?.address && (
          <>
            <Input
              aria-label="REALTOR.ca forwarding address"
              readOnly
              value={status.address}
              onFocus={(event) => event.target.select()}
            />
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              <li>Add this address in Gmail under Settings → Forwarding and POP/IMAP.</li>
              <li>Check for the verification code below and enter it in Gmail.</li>
              <li>Create a Gmail filter with <strong>From</strong> set to <strong className="break-all">{`{${REALTOR_CA_SENDERS.join(' ')}}`}</strong>. Choose <strong>Forward it</strong> and select this address. Keep Gmail’s mailbox-wide forwarding disabled.</li>
            </ol>
            {status.verificationCode && (
              <p role="status" className="text-sm">
                Gmail verification code <strong className="font-mono">{status.verificationCode}</strong>
              </p>
            )}
            {checkedForCode && !status.verificationCode && (
              <p role="status" className="text-sm text-muted-foreground">Waiting for Gmail’s verification email.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => update('GET')}>Check for code</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => update('DELETE')}>Disable address</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
