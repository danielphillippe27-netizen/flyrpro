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
      <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border dark:border-gray-700">
        <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Total Addresses</div>
        <div className="text-3xl font-bold dark:text-white">{addresses}</div>
        <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">human leads</div>
      </div>

      {/* Card 2: Mapped Buildings */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border dark:border-gray-700 relative">
        <div className="flex items-center gap-1">
          <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Mapped Buildings</div>
          {showBuildingHint && (
            <span
              className="inline-flex items-center justify-center w-4 h-4 text-xs text-gray-500 dark:text-gray-400 border border-gray-300 dark:border-gray-600 rounded-full cursor-help mb-1"
              title="Some addresses share a building footprint (Townhomes/Duplexes)"
            >
              ?
            </span>
          )}
        </div>
        <div className="text-3xl font-bold dark:text-white">{buildings}</div>
        <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">physical targets</div>
      </div>

      {/* Card 3: Visited */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border dark:border-gray-700">
        <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Visited</div>
        <div className="text-3xl font-bold text-green-600 dark:text-green-500">{visited}</div>
        <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
          {buildings > 0 ? `${stats.progress_pct}% of buildings` : 'no buildings yet'}
        </div>
      </div>

      {/* Card 4: Scan Rate */}
      <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl border dark:border-gray-700">
        <div className="text-sm text-gray-600 dark:text-gray-400 mb-1">Scan Rate</div>
        <div className="text-3xl font-bold text-green-600 dark:text-green-500">{scan_rate}%</div>
        <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">{stats.scanned} scanned</div>
      </div>
    </div>
  );
}
