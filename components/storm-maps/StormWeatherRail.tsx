'use client';
import type { StormGLSettings } from '@/lib/storm-maps/gl-settings';
import { hailViewSettings, hurricaneViewSettings, STRONGEST_STORM_SETTINGS } from '@/lib/storm-maps/gl-settings';

type Props = { settings: StormGLSettings; onChange: (settings: StormGLSettings) => void };
export function StormWeatherRail({ settings, onChange }: Props) {
  const layers = [
    { label: 'Hail', detail: 'Estimated hail size over the past 24 hours. Click an intensity zone to create a territory.', active: settings.shade === 'hail-size-max', apply: () => hailViewSettings(settings, 'history') },
    { label: 'Thunder', detail: 'Thunderstorm cells, movement and lightning threat areas.', active: settings.cells && settings.lightningThreats, apply: () => ({ ...settings, mode: 'live' as const, cells: !settings.cells, lightningThreats: !settings.cells, inspector: true }) },
    { label: 'Hurricane', detail: 'Infrared satellite imagery with tropical cyclone tracks and forecast cones.', active: settings.cyclones, apply: () => hurricaneViewSettings(settings, 'satellite') },
    { label: 'Wind speed', detail: 'Sustained wind speed. Hover to inspect speed and direction.', active: settings.shade === 'wind-speeds', apply: () => ({ ...settings, shade: settings.shade === 'wind-speeds' ? 'none' as const : 'wind-speeds' as const, inspector: true }) },
    { label: 'Wind gusts', detail: 'Short bursts of wind; separate from sustained wind speed.', active: settings.shade === 'wind-gusts', apply: () => ({ ...settings, shade: settings.shade === 'wind-gusts' ? 'none' as const : 'wind-gusts' as const, inspector: true }) },
    { label: 'Radar', detail: 'Precipitation intensity. Forecast mode uses model precipitation.', active: settings.radar, apply: () => ({ ...settings, radar: !settings.radar, inspector: true }) },
    { label: 'Wind particles', detail: 'Animated wind flow showing direction and speed.', active: settings.wind, apply: () => ({ ...settings, wind: !settings.wind, inspector: true }) },
    { label: 'Lightning', detail: 'Observed lightning flashes and strikes where available.', active: settings.lightning, apply: () => ({ ...settings, lightning: !settings.lightning, inspector: true }) },
  ];
  return <aside aria-label="Weather layers" className="absolute right-4 top-5 z-30 flex max-h-[60%] w-40 flex-col gap-2 overflow-y-auto rounded-2xl border border-white/15 bg-slate-950/95 p-3 text-white shadow-xl max-sm:w-28">
    <h2 className="text-xs font-semibold">Weather layers</h2>
    <label className="text-[10px] text-slate-400">Weather focus<select aria-label="Weather focus" defaultValue="" onChange={event => { const focus = event.target.value; if (focus === 'tropical') onChange(hurricaneViewSettings(settings, 'satellite')); else if (focus === 'severe') onChange({ ...STRONGEST_STORM_SETTINGS, units: settings.units }); else if (focus === 'general') onChange({ ...settings, shade: 'wind-speeds', mode: 'live', wind: true, radar: true, lightning: false, lightningThreats: false, hail: false, cells: false, cyclones: false, inspector: true }); }} className="mt-1 w-full rounded-lg border border-white/15 bg-slate-950 p-2 text-xs text-white"><option value="" disabled>Choose focus</option><option value="general">General</option><option value="severe">Severe</option><option value="tropical">Tropical</option></select></label>
    {layers.map(layer => <button key={layer.label} type="button" title={layer.detail} aria-pressed={layer.active} onClick={() => onChange(layer.apply())} className={`rounded-lg border px-3 py-2 text-left text-xs focus-visible:outline focus-visible:outline-cyan-300 ${layer.active ? 'border-cyan-300 bg-cyan-300/15 text-cyan-200' : 'border-white/15 hover:bg-white/10'}`}>{layer.label}</button>)}
  </aside>;
}
