'use client';

import { useEffect, useState, useRef } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Cloud, MapPin } from 'lucide-react';
import { fetchWeather, type WeatherData } from '@/lib/weather';

const DEFAULT_LAT = 40.7128;
const DEFAULT_LON = -74.006;

export function WeatherWidget() {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locationLabel, setLocationLabel] = useState<string>('');
  const hasRefinedWithGeo = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function loadWithCoords(lat: number, lon: number) {
      try {
        const data = await fetchWeather(lat, lon);
        if (!cancelled) {
          setWeather(data);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError('Unable to load weather');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    // Fetch immediately with default location so the widget appears fast
    loadWithCoords(DEFAULT_LAT, DEFAULT_LON);

    return () => {
      cancelled = true;
    };
  }, []);

  // Optionally refine with geolocation in the background (no blocking)
  useEffect(() => {
    if (!navigator?.geolocation || hasRefinedWithGeo.current) return;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (hasRefinedWithGeo.current) return;
        hasRefinedWithGeo.current = true;
        const { latitude, longitude } = pos.coords;
        fetchWeather(latitude, longitude)
          .then((data) => {
            setWeather(data);
          })
          .catch(() => {});
      },
      () => {},
      { timeout: 5000, maximumAge: 600000 }
    );
  }, []);

  if (loading) {
    return (
      <Card className="h-full flex flex-col rounded-xl border border-border shadow-sm">
        <CardHeader className="pb-2 shrink-0">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Cloud className="w-4 h-4" />
            <span className="text-sm font-medium">Weather</span>
          </div>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col justify-center min-h-0">
          <div className="h-16 rounded-md bg-muted animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  if (error || !weather) {
    return (
      <Card className="h-full flex flex-col rounded-xl border border-border shadow-sm">
        <CardHeader className="pb-2 shrink-0">
          <span className="text-sm font-medium text-foreground">Weather</span>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col justify-center min-h-0">
          <p className="text-sm text-muted-foreground">{error ?? '—'}</p>
          <p className="text-xs text-muted-foreground mt-1">
            <MapPin className="w-3 h-3 inline mr-1" />
            Set location in settings
          </p>
        </CardContent>
      </Card>
    );
  }

  const { current, daily } = weather;

  return (
    <Card className="h-full flex flex-col rounded-xl border border-border shadow-sm">
      <CardHeader className="pb-2 shrink-0">
        <div className="flex items-center gap-2 text-foreground">
          <Cloud className="w-4 h-4" />
          <span className="text-sm font-medium">Weather</span>
          {locationLabel && (
            <span className="text-xs text-muted-foreground">({locationLabel})</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-center space-y-3 min-h-0">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold text-foreground">
            {Math.round(current.temp)}°
          </span>
          <span className="text-sm text-muted-foreground">{current.condition}</span>
        </div>
        <div className="flex gap-4 pt-2 border-t border-border">
          {daily.map((d) => (
            <div key={d.date} className="text-center">
              <p className="text-xs text-muted-foreground">
                {new Date(d.date).toLocaleDateString('en-US', { weekday: 'short' })}
              </p>
              <p className="text-sm font-medium text-foreground">
                {Math.round(d.tempMax)}° / {Math.round(d.tempMin)}°
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
