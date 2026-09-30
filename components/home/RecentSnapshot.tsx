'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { ChevronRight } from 'lucide-react';
import type { IndustryCopy } from '@/lib/industry-copy';

interface RecentSnapshotProps {
  recentCampaigns: { id: string; name: string }[];
  copy: IndustryCopy;
  demo?: boolean;
}

export function RecentSnapshot({ recentCampaigns, copy, demo = false }: RecentSnapshotProps) {
  return (
    <Card className="rounded-xl border border-border shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">{demo ? 'Recent activity' : copy.home.recentCampaignsTitle}</h2>
          {demo ? (
            <span className="text-xs font-medium text-amber-700 dark:text-amber-300">Examples</span>
          ) : (
            <Link
              href="/campaigns"
              className="text-sm text-primary hover:underline flex items-center gap-1"
            >
              {copy.home.recentCampaignsLink}
              <ChevronRight className="w-4 h-4" />
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {recentCampaigns.length === 0 ? (
          <p className="text-sm text-muted-foreground">{copy.home.recentCampaignsEmpty}</p>
        ) : (
          <ul className="space-y-2">
            {recentCampaigns.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2">
                <span className="text-sm text-foreground truncate">{c.name}</span>
                {demo ? (
                  <span className="text-xs text-muted-foreground">This week</span>
                ) : (
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/campaigns/${c.id}`}>Open</Link>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
