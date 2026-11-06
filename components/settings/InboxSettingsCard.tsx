'use client';

import Link from 'next/link';
import { Inbox } from 'lucide-react';
import { useInboxEnabled } from '@/lib/hooks/useInboxEnabled';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';

export function InboxSettingsCard() {
  const { enabled, loading, saving, error, setEnabled } = useInboxEnabled();
  return <Card>
    <CardHeader>
      <div className="flex items-center gap-2"><Inbox className="h-5 w-5" /><CardTitle>Inbox</CardTitle></div>
      <CardDescription>You must connect your Gmail and download the WolfGrid Mac app to use Inbox.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <label htmlFor="show-inbox" className="font-medium">Show Inbox</label>
        <Switch id="show-inbox" checked={enabled} disabled={loading || saving} onCheckedChange={setEnabled} aria-describedby="inbox-visibility" />
      </div>
      <p id="inbox-visibility" className="text-sm text-muted-foreground">Show Inbox in navigation when it is available for your account. Turning it off keeps your messages.</p>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm"><Link href="/settings/integrations#gmail">Connect Gmail</Link></Button>
        <Button asChild variant="outline" size="sm"><Link href="/settings/mac">Mac app setup</Link></Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </CardContent>
  </Card>;
}
