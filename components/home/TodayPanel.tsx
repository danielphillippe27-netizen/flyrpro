'use client';

import { WeatherWidget } from './WeatherWidget';
import { DailyQuote } from './DailyQuote';

export function TodayPanel() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="w-full aspect-square min-h-0">
        <WeatherWidget />
      </div>
      <div className="w-full aspect-square min-h-0">
        <DailyQuote />
      </div>
    </div>
  );
}
