'use client';

import { useEffect, useState } from 'react';
import { Cloud } from 'lucide-react';
import { fetchWeather } from '@/lib/weather';

interface HomeHeaderRowProps {
  firstName: string;
  doorsThisWeek: number;
  weeklyDoorGoal: number;
  dayStreak: number;
  lastSessionAt: string | null;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

const DEFAULT_LAT = 40.7128;
const DEFAULT_LON = -74.006;

export function HomeHeaderRow({
  firstName,
}: HomeHeaderRowProps) {
  const [weather, setWeather] = useState<{ temp: number; condition: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchWeather(DEFAULT_LAT, DEFAULT_LON)
      .then((data) => {
        if (!cancelled) {
          setWeather({
            temp: data.current.temp,
            condition: data.current.condition,
          });
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return (
    <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-border">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Home</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {getGreeting()}, {firstName}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <p className="text-sm font-medium text-foreground">Get after it</p>
        {weather ? (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Cloud className="w-4 h-4" />
            <span>{Math.round(weather.temp)}° · {weather.condition}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Cloud className="w-4 h-4 animate-pulse" />
            <span>—</span>
          </div>
        )}
      </div>
    </header>
  );
}
