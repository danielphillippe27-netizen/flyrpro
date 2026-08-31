export type StormMapsProvider = 'tomorrow' | 'iem' | 'eccc';

export type StormRasterLayerId =
  | 'radar'
  | 'precipitationType'
  | 'forecastPrecipitation'
  | 'accumulation1h'
  | 'accumulation6h'
  | 'accumulation24h'
  | 'snow'
  | 'ice'
  | 'temperature'
  | 'feelsLike'
  | 'windSpeed'
  | 'windGust'
  | 'cloudCover'
  | 'lightning'
  | 'hailBinary'
  | 'hailProbability'
  | 'hailSize';

export type StormLegendStop = {
  value: number;
  label: string;
  color: string;
};

export type StormRasterLayer = {
  id: StormRasterLayerId;
  label: string;
  description: string;
  provider: StormMapsProvider;
  unit: string;
  group: 'Observed' | 'Severe' | 'Forecast';
  premium?: boolean;
  coverageLabel?: string;
  available: boolean;
  unavailableReason?: string;
  frames: Array<{ key: string; time: string; label: string }>;
  legend: StormLegendStop[];
};

export type StormMapsManifest = {
  enabled: true;
  generatedAt: string;
  expiresAt: string;
  tileToken: string;
  radarProvider: 'iem' | 'eccc';
  layers: StormRasterLayer[];
  featureEndpoint: string;
  providerHealth: Record<StormMapsProvider, { available: boolean; status: 'ready' | 'unconfigured' }>;
  attribution: Array<{ label: string; url: string }>;
  disclaimer: string;
};

export type StormFeatureProperties = {
  id: string;
  kind: 'alert' | 'outlook' | 'report';
  provider: 'noaa' | 'eccc' | 'iem';
  event: string;
  severity: 'extreme' | 'severe' | 'moderate' | 'minor' | 'unknown';
  category: 'tornado' | 'thunderstorm' | 'hail' | 'flood' | 'winter' | 'outlook' | 'other' | 'report';
  headline: string;
  description?: string | null;
  sentAt?: string | null;
  endsAt?: string | null;
  url?: string | null;
  magnitude?: string | null;
  riskLevel?: number | null;
  hailSizeCm?: number | null;
  gustKph?: number | null;
  confidence?: number | null;
  impact?: number | null;
  experimental?: boolean;
};
