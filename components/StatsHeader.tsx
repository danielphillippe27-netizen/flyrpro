import type { CampaignStats } from '@/lib/services/CampaignsService';

interface StatsHeaderProps {
  stats: CampaignStats;
}

export function StatsHeader({ stats }: StatsHeaderProps) {
  const { addresses, buildings, visited, scan_rate } = stats;
  
  // Show tooltip hint when buildings < addresses (townhomes/duplexes consolidation)
  const showBuildingHint = buildings > 0 && buildings < addresses;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {/* Card 1: Total Addresses */}
      <div className="bg-card text-card-foreground p-6 rounded-2xl border border-border">
        <div className="text-sm text-muted-foreground mb-1">Total Addresses</div>
        <div className="text-3xl font-bold">{addresses}</div>
        <div className="text-xs text-muted-foreground mt-1">human leads</div>
      </div>

      {/* Card 2: Mapped Buildings */}
      <div className="bg-card text-card-foreground p-6 rounded-2xl border border-border relative">
        <div className="flex items-center gap-1">
          <div className="text-sm text-muted-foreground mb-1">Mapped Buildings</div>
          {showBuildingHint && (
            <span
              className="inline-flex items-center justify-center w-4 h-4 text-xs text-muted-foreground border border-border rounded-full cursor-help mb-1"
              title="Some addresses share a building footprint (Townhomes/Duplexes)"
            >
              ?
            </span>
          )}
        </div>
        <div className="text-3xl font-bold">{buildings}</div>
        <div className="text-xs text-muted-foreground mt-1">physical targets</div>
      </div>

      {/* Card 3: Visited */}
      <div className="bg-card text-card-foreground p-6 rounded-2xl border border-border">
        <div className="text-sm text-muted-foreground mb-1">Visited</div>
        <div className="text-3xl font-bold text-green-600 dark:text-green-500">{visited}</div>
        <div className="text-xs text-muted-foreground mt-1">
          {buildings > 0 ? `${stats.progress_pct}% of buildings` : 'no buildings yet'}
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
