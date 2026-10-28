import { hailViewSettings, type StormGLSettings } from './gl-settings';

export const AUSTRALIAN_STORM_LOCATIONS = [
  { id: 'brisbane', name: 'Brisbane / Southeast Queensland', center: [153.0251, -27.4698], zoom: 7 },
  { id: 'sydney', name: 'Sydney / New South Wales', center: [151.2093, -33.8688], zoom: 7 },
  { id: 'melbourne', name: 'Melbourne / Victoria', center: [144.9631, -37.8136], zoom: 7 },
  { id: 'adelaide', name: 'Adelaide / South Australia', center: [138.6007, -34.9285], zoom: 7 },
  { id: 'perth', name: 'Perth / Western Australia', center: [115.8605, -31.9505], zoom: 7 },
  { id: 'darwin', name: 'Darwin / Northern Territory', center: [130.8456, -12.4634], zoom: 7 },
  { id: 'hobart', name: 'Hobart / Tasmania', center: [147.3272, -42.8821], zoom: 7 },
] satisfies Array<{ id: string; name: string; center: [number, number]; zoom: number }>;

export function australianHailSettings(settings: StormGLSettings, view: 'live' | 'history'): StormGLSettings {
  return {
    ...hailViewSettings(settings, view), units: 'metric',
    // These feeds currently use North American sources in WolfGrid.
    cells: false, stormCones: false, reports: false, alerts: false, outlook: false,
    cyclones: false, pressure: false, impact: false,
    hail: view === 'live', lightning: view === 'live', lightningThreats: view === 'live',
  };
}

export type AustralianWeatherView = { view: 'live' | 'history'; range?: { start: Date; end: Date } };

export function australianHailDay(date: string, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const start = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(+start) || start.toISOString().slice(0, 10) !== date || +start > now) return null;
  const end = new Date(Math.min(+start + 86400000, now));
  return { start, end, mapAvailable: +start >= now - 7 * 86400000 };
}
