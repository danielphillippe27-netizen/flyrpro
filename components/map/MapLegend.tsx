'use client';

import { MAP_STATUS_CONFIG, MAP_STATUS_PRIORITY, type MapStatusKey, type StatusFilters } from '@/lib/constants/mapStatus';

interface MapLegendProps {
  statusFilters: StatusFilters;
  onFilterChange: (key: MapStatusKey, enabled: boolean) => void;
}

/**
 * Map Legend component with status color indicators and toggle filters
 * Compact card positioned at bottom-left of the map
 */
export function MapLegend({ statusFilters, onFilterChange }: MapLegendProps) {
  return (
    <div className="bg-white/95 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 p-3 min-w-[160px]">
      <div className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">
        Legend
      </div>
      <div className="space-y-1.5">
        {MAP_STATUS_PRIORITY.map((key) => {
          const config = MAP_STATUS_CONFIG[key];
          const isEnabled = statusFilters[key];
          
          return (
            <label
              key={key}
              className="flex items-center gap-2 cursor-pointer group"
            >
              <input
                type="checkbox"
                checked={isEnabled}
                onChange={(e) => onFilterChange(key, e.target.checked)}
                className="sr-only"
              />
              {/* Custom checkbox with color indicator */}
              <span
                className={`
                  w-4 h-4 rounded-sm border-2 flex items-center justify-center transition-all
                  ${isEnabled 
                    ? 'border-transparent' 
                    : 'border-gray-300 bg-gray-100'
                  }
                `}
                style={{
                  backgroundColor: isEnabled ? config.color : undefined,
                }}
              >
                {isEnabled && (
                  <svg
                    className="w-2.5 h-2.5 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                )}
              </span>
              {/* Label */}
              <span
                className={`
                  text-xs transition-colors
                  ${isEnabled 
                    ? 'text-gray-700' 
                    : 'text-gray-400 line-through'
                  }
                `}
              >
                {config.label}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
