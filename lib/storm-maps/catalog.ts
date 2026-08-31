import type {
  StormLegendStop,
  StormMapsProvider,
  StormRasterLayer,
  StormRasterLayerId,
} from './types';

type CatalogEntry = Omit<StormRasterLayer, 'provider' | 'available' | 'frames'> & {
  tomorrowField?: string;
  aggregationHours?: 1 | 6 | 24;
  premium?: boolean;
  coverageLabel?: string;
  mapGradient?: string;
};

const PRECIPITATION_LEGEND: StormLegendStop[] = [
  { value: 0.1, label: 'Light', color: '#38bdf8' },
  { value: 2, label: 'Moderate', color: '#22c55e' },
  { value: 8, label: 'Heavy', color: '#facc15' },
  { value: 20, label: 'Extreme', color: '#f43f5e' },
];

const TEMPERATURE_LEGEND: StormLegendStop[] = [
  { value: -20, label: '-20°C', color: '#6d5dfc' },
  { value: 0, label: '0°C', color: '#38bdf8' },
  { value: 20, label: '20°C', color: '#facc15' },
  { value: 35, label: '35°C', color: '#f97316' },
];

const WIND_LEGEND: StormLegendStop[] = [
  { value: 10, label: 'Breezy', color: '#67e8f9' },
  { value: 30, label: 'Strong', color: '#facc15' },
  { value: 60, label: 'Severe', color: '#fb7185' },
];

export const STORM_RASTER_CATALOG: Record<StormRasterLayerId, CatalogEntry> = {
  radar: {
    id: 'radar',
    label: 'Live radar',
    description: 'Observed precipitation, animated over the previous hour.',
    unit: 'dBZ',
    group: 'Observed',
    legend: PRECIPITATION_LEGEND,
  },
  precipitationType: {
    id: 'precipitationType',
    label: 'Precipitation type',
    description: 'Rain, snow, freezing rain, and ice pellets.',
    unit: 'type',
    group: 'Forecast',
    tomorrowField: 'precipitationType',
    legend: [
      { value: 1, label: 'Rain', color: '#38bdf8' },
      { value: 2, label: 'Snow', color: '#e0f2fe' },
      { value: 3, label: 'Freezing rain', color: '#a78bfa' },
      { value: 4, label: 'Ice pellets', color: '#f0abfc' },
    ],
  },
  forecastPrecipitation: {
    id: 'forecastPrecipitation',
    label: 'Forecast precipitation',
    description: 'Expected precipitation intensity.',
    unit: 'mm/h',
    group: 'Forecast',
    tomorrowField: 'precipitationIntensity',
    legend: PRECIPITATION_LEGEND,
  },
  accumulation1h: {
    id: 'accumulation1h',
    label: 'Accumulation · 1 hour',
    description: 'Total precipitation over one hour.',
    unit: 'mm',
    group: 'Forecast',
    tomorrowField: 'precipitationIntensity',
    aggregationHours: 1,
    legend: PRECIPITATION_LEGEND,
  },
  accumulation6h: {
    id: 'accumulation6h',
    label: 'Accumulation · 6 hours',
    description: 'Total precipitation over six hours.',
    unit: 'mm',
    group: 'Forecast',
    tomorrowField: 'precipitationIntensity',
    aggregationHours: 6,
    legend: PRECIPITATION_LEGEND,
  },
  accumulation24h: {
    id: 'accumulation24h',
    label: 'Accumulation · 24 hours',
    description: 'Total precipitation over twenty-four hours.',
    unit: 'mm',
    group: 'Forecast',
    tomorrowField: 'precipitationIntensity',
    aggregationHours: 24,
    legend: PRECIPITATION_LEGEND,
  },
  snow: {
    id: 'snow',
    label: 'Snow',
    description: 'Expected snowfall intensity.',
    unit: 'mm/h',
    group: 'Forecast',
    tomorrowField: 'snowIntensity',
    legend: [
      { value: 0.1, label: 'Light', color: '#dbeafe' },
      { value: 2, label: 'Moderate', color: '#67e8f9' },
      { value: 8, label: 'Heavy', color: '#8b5cf6' },
    ],
  },
  ice: {
    id: 'ice',
    label: 'Freezing rain & ice',
    description: 'Expected freezing-rain intensity.',
    unit: 'mm/h',
    group: 'Forecast',
    tomorrowField: 'freezingRainIntensity',
    legend: [
      { value: 0.1, label: 'Light', color: '#c4b5fd' },
      { value: 2, label: 'Moderate', color: '#a78bfa' },
      { value: 6, label: 'Heavy', color: '#f0abfc' },
    ],
  },
  temperature: {
    id: 'temperature',
    label: 'Temperature',
    description: 'Air temperature two metres above ground.',
    unit: '°C',
    group: 'Forecast',
    tomorrowField: 'temperature',
    legend: TEMPERATURE_LEGEND,
  },
  feelsLike: {
    id: 'feelsLike',
    label: 'Feels like',
    description: 'Apparent temperature from humidity and wind.',
    unit: '°C',
    group: 'Forecast',
    tomorrowField: 'temperatureApparent',
    legend: TEMPERATURE_LEGEND,
  },
  windSpeed: {
    id: 'windSpeed',
    label: 'Wind speed',
    description: 'Sustained wind speed.',
    unit: 'km/h',
    group: 'Forecast',
    tomorrowField: 'windSpeed',
    legend: WIND_LEGEND,
  },
  windGust: {
    id: 'windGust',
    label: 'Wind gusts',
    description: 'Maximum brief wind gust.',
    unit: 'km/h',
    group: 'Forecast',
    tomorrowField: 'windGust',
    legend: WIND_LEGEND,
  },
  cloudCover: {
    id: 'cloudCover',
    label: 'Cloud cover',
    description: 'Percentage of sky covered by clouds.',
    unit: '%',
    group: 'Forecast',
    tomorrowField: 'cloudCover',
    legend: [
      { value: 10, label: 'Mostly clear', color: '#bae6fd' },
      { value: 50, label: 'Broken', color: '#94a3b8' },
      { value: 90, label: 'Overcast', color: '#475569' },
    ],
  },
  lightning: {
    id: 'lightning',
    label: 'Lightning / thunder risk',
    description: 'Forecast lightning flash-rate density.',
    unit: 'flashes/km²',
    group: 'Severe',
    tomorrowField: 'lightningFlashRateDensity',
    premium: true,
    legend: [
      { value: 0.1, label: 'Possible', color: '#fde047' },
      { value: 1, label: 'Elevated', color: '#fb923c' },
      { value: 4, label: 'High', color: '#e879f9' },
    ],
  },
  hailProbability: {
    id: 'hailProbability',
    label: 'Hail probability',
    description: 'Premium forecast probability of hail during the next 36 hours.',
    unit: '%',
    group: 'Severe',
    tomorrowField: 'hailProbability',
    premium: true,
    coverageLabel: 'Worldwide · Nextgen',
    mapGradient: '0:00000000,10:22d3ee99,30:38bdf8b8,60:8b5cf6cc,85:f0abfce6',
    legend: [
      { value: 10, label: 'Possible', color: '#22d3ee' },
      { value: 30, label: 'Elevated', color: '#38bdf8' },
      { value: 60, label: 'Likely', color: '#8b5cf6' },
      { value: 85, label: 'Extreme', color: '#f0abfc' },
    ],
  },
  hailSize: {
    id: 'hailSize',
    label: 'Forecast hail size',
    description: 'Premium forecast of maximum hailstone diameter during the next 36 hours.',
    unit: 'cm',
    group: 'Severe',
    tomorrowField: 'hailSize',
    premium: true,
    coverageLabel: 'Worldwide · Nextgen',
    mapGradient: '0:00000000,0.5:67e8f999,1.5:38bdf8b8,2.5:a78bfacc,5:f472b6e6',
    legend: [
      { value: 0.5, label: 'Pea · 0.5 cm', color: '#67e8f9' },
      { value: 1.5, label: 'Dime · 1.5 cm', color: '#38bdf8' },
      { value: 2.5, label: 'Quarter · 2.5 cm', color: '#a78bfa' },
      { value: 5, label: 'Major · 5+ cm', color: '#f472b6' },
    ],
  },
  hailBinary: {
    id: 'hailBinary',
    label: 'Hail potential',
    description: 'Advanced Precipitation hail signal for Canada and the United States.',
    unit: 'risk',
    group: 'Severe',
    tomorrowField: 'hailBinary',
    premium: true,
    coverageLabel: 'Canada + U.S. · Advanced Precipitation',
    mapGradient: '0:00000000,1:a855f7dc',
    legend: [
      { value: 1, label: 'Hail signal', color: '#a855f7' },
    ],
  },
};

export function isStormRasterLayerId(value: string): value is StormRasterLayerId {
  return Object.prototype.hasOwnProperty.call(STORM_RASTER_CATALOG, value);
}

export function providerForLayer(
  layerId: StormRasterLayerId,
  radarProvider: 'iem' | 'eccc',
): StormMapsProvider {
  if (layerId === 'radar') return radarProvider;
  if (radarProvider === 'iem' && (layerId === 'accumulation1h' || layerId === 'accumulation24h')) return 'iem';
  return 'tomorrow';
}

export function isProviderAllowedForLayer(provider: StormMapsProvider, layerId: StormRasterLayerId) {
  if (layerId === 'radar') return provider === 'iem' || provider === 'eccc';
  if (layerId === 'accumulation1h' || layerId === 'accumulation24h') return provider === 'iem' || provider === 'tomorrow';
  return provider === 'tomorrow';
}

export function tomorrowFieldForLayer(layerId: StormRasterLayerId): string | null {
  return STORM_RASTER_CATALOG[layerId].tomorrowField ?? null;
}

export function aggregationHoursForLayer(layerId: StormRasterLayerId): number | null {
  return STORM_RASTER_CATALOG[layerId].aggregationHours ?? null;
}

export function mapGradientForLayer(layerId: StormRasterLayerId): string | null {
  return STORM_RASTER_CATALOG[layerId].mapGradient ?? null;
}
