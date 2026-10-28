import type { MapUnits } from '@xweather/mapsgl';
export const UNIT_OPTIONS = {
  temperature: ['C', 'F'], speed: ['km/h', 'kts', 'mph', 'm/s'], pressure: ['hPa', 'mb', 'inHg'],
  distance: ['km', 'mi'], height: ['m', 'ft'], intensity: ['mm/hr', 'in/hr'], precipitation: ['mm', 'in'], snowfall: ['cm', 'in'],
} as const;
export type StormUnitKey = keyof typeof UNIT_OPTIONS;
export type StormDisplaySettings = {
  baseMap: 'auto' | 'streets' | 'light' | 'dark'; projection: 'mercator' | 'globe';
  unitSystem: 'metric' | 'imperial' | 'custom'; customUnits: Pick<MapUnits, StormUnitKey>;
  alwaysShowNames: boolean; autoUpdateMinutes: 0 | 2 | 5 | 10; autoHideControls: boolean;
};
export const METRIC_UNITS: StormDisplaySettings['customUnits'] = { temperature: 'C', speed: 'km/h', pressure: 'hPa', distance: 'km', height: 'm', intensity: 'mm/hr', precipitation: 'mm', snowfall: 'cm' };
export const IMPERIAL_UNITS: StormDisplaySettings['customUnits'] = { temperature: 'F', speed: 'mph', pressure: 'inHg', distance: 'mi', height: 'ft', intensity: 'in/hr', precipitation: 'in', snowfall: 'in' };
export const DEFAULT_STORM_DISPLAY: StormDisplaySettings = { baseMap: 'auto', projection: 'globe', unitSystem: 'metric', customUnits: METRIC_UNITS, alwaysShowNames: true, autoUpdateMinutes: 10, autoHideControls: false };
export function resolveStormBaseMap(baseMap: StormDisplaySettings['baseMap'], theme: 'light' | 'dark') {
  const appearance = baseMap === 'auto' ? theme : baseMap;
  return `mapbox://styles/mapbox/${appearance === 'streets' ? 'streets-v12' : `${appearance}-v11`}`;
}
export function migrateStormDisplay(raw: unknown): StormDisplaySettings {
  const value = readStormDisplay(raw);
  // Older versions saved the hard-coded dark default with every settings edit.
  // Move that default to appearance-following; v3 keeps explicit overrides.
  return { ...value, baseMap: value.baseMap === 'dark' ? 'auto' : value.baseMap };
}
export function readStormDisplay(raw: unknown): StormDisplaySettings {
  const result = { ...DEFAULT_STORM_DISPLAY, customUnits: { ...METRIC_UNITS } };
  if (!raw || typeof raw !== 'object') return result;
  const value = raw as Record<string, unknown>;
  if (['auto','streets','light','dark'].includes(String(value.baseMap))) result.baseMap = value.baseMap as StormDisplaySettings['baseMap'];
  if (value.projection === 'globe' || value.projection === 'mercator') result.projection = value.projection;
  if (['metric','imperial','custom'].includes(String(value.unitSystem))) result.unitSystem = value.unitSystem as StormDisplaySettings['unitSystem'];
  for (const key of ['alwaysShowNames', 'autoHideControls'] as const) if (typeof value[key] === 'boolean') result[key] = value[key];
  if ([0,2,5,10].includes(Number(value.autoUpdateMinutes)) && typeof value.autoUpdateMinutes === 'number') result.autoUpdateMinutes = value.autoUpdateMinutes as StormDisplaySettings['autoUpdateMinutes'];
  const units = value.customUnits as Record<string, unknown> | undefined;
  for (const key of Object.keys(UNIT_OPTIONS) as StormUnitKey[]) if (units && (UNIT_OPTIONS[key] as readonly unknown[]).includes(units[key])) Object.assign(result.customUnits, { [key]: units[key] });
  if (result.unitSystem !== 'custom') result.customUnits = { ...(result.unitSystem === 'metric' ? METRIC_UNITS : IMPERIAL_UNITS) };
  return result;
}
