/**
 * Lightweight weather client for Home dashboard.
 * Uses Open-Meteo (no API key required). Optional: set NEXT_PUBLIC_WEATHER_API_KEY
 * and use a different provider in the future.
 * TODO: Support saved user location from profile when available.
 */

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min
const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';

export interface WeatherCurrent {
  temp: number;
  condition: string;
  code: number;
}

export interface WeatherDay {
  date: string;
  tempMax: number;
  tempMin: number;
  code: number;
  condition: string;
}

export interface WeatherData {
  current: WeatherCurrent;
  daily: WeatherDay[];
}

const WEATHER_CODE_MAP: Record<number, string> = {
  0: 'Clear',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Foggy',
  48: 'Foggy',
  51: 'Drizzle',
  53: 'Drizzle',
  55: 'Drizzle',
  61: 'Rain',
  63: 'Rain',
  65: 'Heavy rain',
  71: 'Snow',
  73: 'Snow',
  75: 'Heavy snow',
  80: 'Showers',
  81: 'Showers',
  82: 'Heavy showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm',
  99: 'Thunderstorm',
};

function codeToCondition(code: number): string {
  return WEATHER_CODE_MAP[code] ?? 'Unknown';
}

let cache: { key: string; data: WeatherData; at: number } | null = null;

function cacheKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)},${lon.toFixed(2)}`;
}

export async function fetchWeather(lat: number, lon: number): Promise<WeatherData> {
  const key = cacheKey(lat, lon);
  if (cache && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.data;
  }

  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    timezone: 'auto',
    forecast_days: '3',
  });

  const url = `${OPEN_METEO_BASE}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Weather fetch failed');

  const json = (await res.json()) as {
    current?: { temperature_2m?: number; weather_code?: number };
    daily?: {
      time?: string[];
      weather_code?: number[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
    };
  };

  const currentCode = json.current?.weather_code ?? 0;
  const daily = json.daily;
  const times = daily?.time ?? [];
  const codes = daily?.weather_code ?? [];
  const maxT = daily?.temperature_2m_max ?? [];
  const minT = daily?.temperature_2m_min ?? [];

  const weatherData: WeatherData = {
    current: {
      temp: json.current?.temperature_2m ?? 0,
      condition: codeToCondition(currentCode),
      code: currentCode,
    },
    daily: times.slice(0, 3).map((date, i) => ({
      date,
      tempMax: maxT[i] ?? 0,
      tempMin: minT[i] ?? 0,
      code: codes[i] ?? 0,
      condition: codeToCondition(codes[i] ?? 0),
    })),
  };

  cache = { key, data: weatherData, at: Date.now() };
  return weatherData;
}
