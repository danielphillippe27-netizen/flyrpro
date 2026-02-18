import type { CampaignStats } from '@/lib/services/CampaignsService';

interface StatsHeaderProps {
  stats: CampaignStats;
}

export function StatsHeader({ stats }: StatsHeaderProps) {
  const { addresses, contacts, contacted, visited, scan_rate } = stats;

  const visitPct = addresses > 0 ? Math.round((visited / addresses) * 100) : 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {/* Card 1: Total Leads (contact count; 0 until user adds contacts) */}
      <div className="bg-card text-card-foreground p-6 rounded-2xl border border-border">
        <div className="text-sm text-muted-foreground mb-1">Total Leads</div>
        <div className="text-3xl font-bold">{contacts ?? 0}</div>
        <div className="text-xs text-muted-foreground mt-1">contacts in campaign</div>
      </div>

      {/* Card 2: Contacted */}
      <div className="bg-card text-card-foreground p-6 rounded-2xl border border-border">
        <div className="text-sm text-muted-foreground mb-1">Contacted</div>
        <div className="text-3xl font-bold">{contacted}</div>
        <div className="text-xs text-muted-foreground mt-1">leads reached</div>
      </div>

      {/* Card 3: Visited */}
      <div className="bg-card text-card-foreground p-6 rounded-2xl border border-border">
        <div className="text-sm text-muted-foreground mb-1">Visited</div>
        <div className="text-3xl font-bold text-green-600 dark:text-green-500">{visited}</div>
        <div className="text-xs text-muted-foreground mt-1">
          {addresses > 0 ? `${visitPct}% of leads` : 'no leads yet'}
        </div>
      </div>

      {/* Card 4: Scan Rate */}
      <div className="bg-card text-card-foreground p-6 rounded-2xl border border-border">
        <div className="text-sm text-muted-foreground mb-1">Scan Rate</div>
        <div className="text-3xl font-bold text-green-600 dark:text-green-500">{scan_rate}%</div>
        <div className="text-xs text-muted-foreground mt-1">{stats.scanned} scanned</div>
      </div>
    </div>
  );
}
