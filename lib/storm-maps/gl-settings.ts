export const WEATHER_SHADES = [
  { id: 'hail-size', label: 'Hourly hail size', unit: 'mm / in' },
  { id: 'hail-size-max', label: 'Maximum hail size over history', unit: 'mm / in' },
  { id: 'hail-severe-probability-max', label: 'Maximum severe hail probability', unit: '%' },
  { id: 'temperatures', label: 'Temperature', unit: '°C / °F' },
  { id: 'wind-speeds', label: 'Wind speed', unit: 'km/h / mph' },
  { id: 'wind-gusts', label: 'Wind gusts', unit: 'km/h / mph' },
  { id: 'precip', label: 'Precipitation', unit: 'Rain / snow' },
  { id: 'cloud-cover', label: 'Cloud cover', unit: '%' },
  { id: 'snow', label: 'Snow depth', unit: 'cm / in' },
  { id: 'feels-like', label: 'Feels like', unit: '°C / °F' },
  { id: 'humidity', label: 'Humidity', unit: '%' },
  { id: 'none', label: 'Storm focus (clear basemap)', unit: '' },
] as const;
export type WeatherShade = typeof WEATHER_SHADES[number]['id'];
export type WeatherMode = 'live' | 'history' | 'forecast';
export type WeatherToggle = 'wind' | 'radar' | 'lightning' | 'lightningThreats' | 'hail' | 'cells' | 'alerts' | 'outlook' | 'reports' | 'inspector' | 'impact';
export type StormGLSettings = Record<WeatherToggle, boolean> & {
  shade: WeatherShade; mode: WeatherMode; opacity: number; radarOpacity: number;
  speed: number; historyHours: number; units: 'metric' | 'imperial';
};
export const STRONGEST_STORM_SETTINGS: StormGLSettings = {
  shade: 'none', mode: 'live', opacity: 75, radarOpacity: 80,
  wind: true, radar: true, lightning: true, lightningThreats: true, hail: true,
  cells: true, alerts: true, outlook: true, reports: true, inspector: true, impact: true,
  speed: 12, historyHours: 6, units: 'metric',
};
export const STORM_LAYER_GROUPS = [
  { key: 'radar', title: 'Precipitation radar', detail: 'Rain, mixed precipitation & snow', ids: ['radar'] },
  { key: 'hail', title: 'Hail threats & tracks', detail: 'Includes Canada · nowcast up to 1 hour', ids: ['hail-threats-polygons', 'hail-threats-tracks', 'hail-threats-points'] },
  { key: 'cells', title: 'Storm cells & cones', detail: 'U.S. radar cells, movement & forecast cones', ids: ['stormcells-positions', 'stormcells-tracks', 'stormcells-cones'] },
  { key: 'lightning', title: 'Lightning activity', detail: 'Flashes & cloud-to-ground strikes · global', ids: ['lightning-flash', 'lightning-strikes'] },
  { key: 'lightningThreats', title: 'Lightning threat zones', detail: 'Observed & forecast threat areas', ids: ['lightning-threats-polygons', 'lightning-threats-tracks', 'lightning-threats-points'] },
  { key: 'wind', title: 'Wind particles', detail: 'Animated direction & speed', ids: ['wind-particles'] },
] as const;
export function readStormGLSettings(raw: unknown): StormGLSettings {
  const result = { ...STRONGEST_STORM_SETTINGS };
  if (!raw || typeof raw !== 'object') return result;
  const data = raw as Record<string, unknown>;
  // Upgrade the previous untouched preset; preserve deliberate custom views.
  const legacyPreset = { ...STRONGEST_STORM_SETTINGS, shade: 'temperatures', radarOpacity: 95 };
  if (Object.entries(legacyPreset).every(([key, value]) => data[key] === value)) return result;
  for (const key of ['wind', 'radar', 'lightning', 'lightningThreats', 'hail', 'cells', 'alerts', 'outlook', 'reports', 'inspector', 'impact'] as const) {
    if (typeof data[key] === 'boolean') result[key] = data[key];
  }
  if (WEATHER_SHADES.some((shade) => shade.id === data.shade)) result.shade = data.shade as WeatherShade;
  if (['live', 'history', 'forecast'].includes(String(data.mode))) result.mode = data.mode as WeatherMode;
  if (data.units === 'metric' || data.units === 'imperial') result.units = data.units;
  for (const key of ['opacity', 'radarOpacity'] as const) {
    if (typeof data[key] === 'number' && Number.isFinite(data[key])) result[key] = Math.max(0, Math.min(100, data[key]));
  }
  if ([6, 24, 72].includes(Number(data.historyHours))) result.historyHours = Number(data.historyHours);
  if ([6, 12, 24].includes(Number(data.speed))) result.speed = Number(data.speed);
  return result;
}
export function stormTimeRange(mode: WeatherMode, historyHours: number, now = Date.now()) {
  const anchor = Math.floor(now / 1000) * 1000;
  return {
    start: new Date(anchor - (mode === 'forecast' ? 0 : mode === 'history' ? historyHours : 1) * 3600_000),
    end: new Date(anchor + (mode === 'history' ? 0 : mode === 'forecast' ? 24 : 1) * 3600_000),
    current: new Date(anchor),
  };
}

export function hailViewSettings(settings: StormGLSettings, view: 'live' | 'history'): StormGLSettings {
  return { ...settings, hail: true, cells: true, inspector: true, alerts: true,
    mode: view === 'live' ? 'live' : 'history', shade: view === 'live' ? 'none' : 'hail-size-max',
    historyHours: view === 'history' ? 24 : settings.historyHours,
    wind: false, radar: view === 'live', opacity: 85, radarOpacity: 55 };
}

export function isHistoricalHailShade(shade: WeatherShade) {
  return shade === 'hail-size' || shade === 'hail-size-max' || shade === 'hail-severe-probability-max';
}
