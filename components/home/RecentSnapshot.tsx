'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ChevronRight } from 'lucide-react';

interface RecentSnapshotProps {
  recentCampaigns: { id: string; name: string }[];
}

export function RecentSnapshot({ recentCampaigns }: RecentSnapshotProps) {
  return (
    <Card className="rounded-xl border border-border shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Recently used campaigns</h2>
          <Link
            href="/campaigns"
            className="text-sm text-primary hover:underline flex items-center gap-1"
          >
            View all campaigns
            <ChevronRight className="w-4 h-4" />
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        {recentCampaigns.length === 0 ? (
          <p className="text-sm text-muted-foreground">No campaigns yet.</p>
        ) : (
          <ul className="space-y-2">
            {recentCampaigns.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2">
                <span className="text-sm text-foreground truncate">{c.name}</span>
                <Button asChild variant="outline" size="sm">
                  <Link href={`/campaigns/${c.id}`}>Open</Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
