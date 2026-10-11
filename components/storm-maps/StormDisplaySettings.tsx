'use client';
import { UNIT_OPTIONS, METRIC_UNITS, IMPERIAL_UNITS, type StormUnitKey, type StormDisplaySettings } from '@/lib/storm-maps/display-settings';
type Props = { value: StormDisplaySettings; onChange: (value: StormDisplaySettings) => void };
export function StormDisplaySettingsPanel({ value, onChange }: Props) {
  const update = <K extends keyof StormDisplaySettings>(key: K, next: StormDisplaySettings[K]) => onChange({ ...value, [key]: next });
  const choices = <T extends string | number>(label: string, current: T, options: readonly T[], change: (next: T) => void) => <fieldset className="space-y-2"><legend className="text-xs font-semibold">{label}</legend><div className="flex flex-wrap gap-1">{options.map(option => <button key={option} type="button" aria-pressed={option === current} onClick={() => change(option)} className={`rounded-lg border px-3 py-2 text-xs capitalize ${option === current ? 'border-cyan-300 bg-cyan-300/15 text-cyan-200' : 'border-white/15 hover:bg-white/10'}`}>{option === 0 ? 'Off' : option === 'kts' ? 'knots' : option}</button>)}</div></fieldset>;
  const labels: Record<StormUnitKey, string> = { temperature:'Temperature', speed:'Speed', pressure:'Pressure', distance:'Distance', height:'Height', intensity:'Precip rate', precipitation:'Rain', snowfall:'Snow' };
  return <div className="space-y-5">
    {choices('Base map', value.baseMap, ['streets','light','dark'] as const, next => update('baseMap',next))}
    {choices('Map projection', value.projection, ['mercator','globe'] as const, next => update('projection',next))}
    <p className="text-[10px] text-slate-400">Flat Mercator or 3D globe. Selecting a territory returns to the flat map for boundary accuracy.</p>
    {choices('Unit system', value.unitSystem, ['custom','metric','imperial'] as const, next => onChange({ ...value, unitSystem: next, customUnits: next === 'custom' ? value.customUnits : { ...(next === 'metric' ? METRIC_UNITS : IMPERIAL_UNITS) } }))}
    <div className="grid grid-cols-2 gap-4">{(Object.keys(UNIT_OPTIONS) as StormUnitKey[]).map(key => <div key={key}>{choices(labels[key], value.customUnits[key], UNIT_OPTIONS[key] as readonly string[], next => onChange({ ...value, unitSystem: 'custom', customUnits: { ...value.customUnits, [key]: next } }))}</div>)}</div>
    <h3 className="border-t border-white/10 pt-4 text-sm font-semibold">General</h3>
    {choices('Always show layer names', value.alwaysShowNames ? 'Yes' : 'No', ['No','Yes'], next => update('alwaysShowNames',next === 'Yes'))}
    {choices('Auto update (minutes)', value.autoUpdateMinutes, [0,2,5,10] as const, next => update('autoUpdateMinutes',next))}
    {choices('Auto hide controls', value.autoHideControls ? 'Yes' : 'No', ['No','Yes'], next => update('autoHideControls',next === 'Yes'))}
    <p className="text-[10px] text-slate-400">Controls hide after 15 seconds of inactivity and return when you interact with the map. Settings are saved for this workspace in this browser.</p>
  </div>;
}
