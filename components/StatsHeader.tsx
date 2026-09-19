import type { CardActivityTotals } from '@/lib/cards/campaign-engagement';
import type { CampaignStats } from '@/lib/services/CampaignsService';

interface StatsHeaderProps {
  stats: CampaignStats;
  engagement: CardActivityTotals & { scans: number };
  engagementState?: 'loading' | 'error' | 'ready';
}

export function StatsHeader({ stats, engagement, engagementState = 'ready' }: StatsHeaderProps) {
  const { addresses, contacts, visited } = stats;

  const totalEngagement = engagement.scans + engagement.opens + engagement.clicks + engagement.downloads;
  const visitPct = addresses > 0 ? Math.round((visited / addresses) * 100) : 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {/* Card 1: Total homes */}
      <div className="bg-card text-card-foreground p-6 rounded-2xl border border-border">
        <div className="text-sm text-muted-foreground mb-1">Total homes</div>
        <div className="text-3xl font-bold">{addresses ?? 0}</div>
        <div className="text-xs text-muted-foreground mt-1">addresses in campaign</div>
      </div>

      {/* Card 2: Leads */}
      <div className="bg-card text-card-foreground p-6 rounded-2xl border border-border">
        <div className="text-sm text-muted-foreground mb-1">Leads</div>
        <div className="text-3xl font-bold">{contacts ?? 0}</div>
        <div className="text-xs text-muted-foreground mt-1">contacts in campaign</div>
      </div>

      {/* Card 3: Visited */}
      <div className="bg-card text-card-foreground p-6 rounded-2xl border border-border">
        <div className="text-sm text-muted-foreground mb-1">Visited</div>
        <div className="text-3xl font-bold text-green-600 dark:text-green-500">{visited}</div>
        <div className="text-xs text-muted-foreground mt-1">
          {addresses > 0 ? `${visitPct}% of houses` : 'no houses yet'}
        </div>
      </div>

      {/* Card 4: Clicks &amp; Scans */}
      <div className="bg-card text-card-foreground p-6 rounded-2xl border border-border">
        <div className="text-sm text-muted-foreground mb-1" title="QR scans, open-only card visits, button clicks, and downloads. A card visit with a button action is counted under clicks or downloads, not again as an open.">Clicks &amp; Scans</div>
        <div className="text-3xl font-bold text-green-600 dark:text-green-500">{engagementState === 'ready' ? totalEngagement.toLocaleString() : '—'}</div>
        <div className="text-xs text-muted-foreground mt-1">{engagementState === 'loading' ? 'Loading engagement…' : engagementState === 'error' ? 'Engagement unavailable' : <span className="flex flex-wrap gap-x-2 gap-y-1">
          <span>{engagement.scans.toLocaleString()} QR scans</span>
          <span title="Card visits without a button action">{engagement.opens.toLocaleString()} Card opens</span>
          <span>{engagement.clicks.toLocaleString()} Button clicks</span>
          <span>{engagement.downloads.toLocaleString()} Downloads</span>
        </span>}</div>
      </div>
    </div>
  );
}
