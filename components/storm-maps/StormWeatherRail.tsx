'use client';
import { useState } from 'react';
import { Settings2, X, CloudHail, CloudLightning, Tornado, Wind, Radar, Zap, Waves, Thermometer, Satellite, ShieldAlert, Cloud } from 'lucide-react';
import type { StormGLSettings } from '@/lib/storm-maps/gl-settings';
import { hailViewSettings, hurricaneViewSettings } from '@/lib/storm-maps/gl-settings';
type Props = { settings: StormGLSettings; onChange: (settings: StormGLSettings) => void; alwaysShowNames?: boolean; onSettings?: () => void; compact?: boolean };
export function StormWeatherRail({ settings, onChange, alwaysShowNames = false }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const shade = (id: StormGLSettings['shade']) => ({ ...settings, shade: settings.shade === id ? 'none' as const : id, inspector: true });
  const layers = [
    { key: 'radar', label: 'Radar', icon: Radar, gradient: 'linear-gradient(130deg,#0e4422,#65bb16,#ffdc00,#eb1717)', detail: 'Precipitation radar; model precipitation in forecast mode.', active: settings.radar, apply: () => ({ ...settings, radar: !settings.radar }) },
    { key: 'satellite-infrared-color', label: 'Satellite', icon: Satellite, gradient: 'linear-gradient(140deg,#283347,#f5f5f5,#5b6f89)', detail: 'Infrared cloud-top temperature imagery, past 6 hours.', active: settings.shade === 'satellite-infrared-color', apply: () => ({ ...settings, shade: settings.shade === 'satellite-infrared-color' ? 'none' as const : 'satellite-infrared-color' as const, mode: 'history' as const, historyHours: 6 }) },
    { key: 'alerts', label: 'Alerts', icon: ShieldAlert, gradient: 'linear-gradient(140deg,#492b62,#b10819,#efdd39)', detail: 'Published official weather warnings and watches.', active: settings.alerts, apply: () => ({ ...settings, alerts: !settings.alerts }) },
    { key: 'temperatures', label: 'Temperatures', icon: Thermometer, gradient: 'linear-gradient(140deg,#391ea8,#02bdfb,#1cff25,#fbef22,#ef1515)', detail: 'Air temperature. Hover for measurements.', active: settings.shade === 'temperatures', apply: () => shade('temperatures') },
    { key: 'wind-speeds', label: 'Wind speed', icon: Wind, gradient: 'linear-gradient(140deg,#2738b2,#00d5f4,#68ee24)', detail: 'Sustained wind speed.', active: settings.shade === 'wind-speeds', apply: () => shade('wind-speeds') },
    { key: 'wind-gusts', label: 'Wind gusts', icon: Wind, gradient: 'linear-gradient(140deg,#222f93,#20bf6f,#fbbb14,#dc2828)', detail: 'Short bursts of wind, separate from sustained speed.', active: settings.shade === 'wind-gusts', apply: () => shade('wind-gusts') },
    { key: 'wind', label: 'Wind particles', icon: Waves, gradient: 'linear-gradient(140deg,#152735,#467d71,#cb951e)', detail: 'Animated wind direction and speed.', active: settings.wind, apply: () => ({ ...settings, wind: !settings.wind }) },
    { key: 'lightning', label: 'Lightning', icon: Zap, gradient: 'linear-gradient(140deg,#483691,#db6123,#ffc72b)', detail: 'Observed lightning flashes and strikes.', active: settings.lightning, apply: () => ({ ...settings, lightning: !settings.lightning }) },
    { key: 'hail-size-max', label: 'Hail', icon: CloudHail, gradient: 'linear-gradient(140deg,#593bad,#19cbd6,#dede18,#e411c9)', detail: 'Maximum estimated hail size over the past 24 hours.', active: settings.shade === 'hail-size-max', apply: () => settings.shade === 'hail-size-max' ? {...settings,shade:'none' as const} : hailViewSettings(settings, 'history') },
    { key: 'cells', label: 'Thunder', icon: CloudLightning, gradient: 'linear-gradient(140deg,#294d25,#83e245,#fbdc32)', detail: 'Storm cells, movement and lightning threats.', active: settings.cells, apply: () => ({ ...settings, cells: !settings.cells, lightningThreats: !settings.cells, mode: 'live' as const }) },
    { key: 'cyclones', label: 'Hurricane', icon: Tornado, gradient: 'linear-gradient(140deg,#283873,#e55cbb,#e03b20)', detail: 'Tropical cyclones with satellite imagery.', active: settings.cyclones, apply: () => settings.cyclones ? {...settings,cyclones:false} : hurricaneViewSettings(settings, 'satellite') },
    { key: 'cloud-cover', label: 'Cloud cover', icon: Cloud, gradient: 'linear-gradient(140deg,#637386,#e7edf2)', detail: 'Cloud coverage percentage.', active: settings.shade === 'cloud-cover', apply: () => shade('cloud-cover') },
  ];
  const selected = layers.find(layer => layer.key === editing && layer.active);
  const defaultOpacity = selected ? selected.key === 'radar' ? settings.radarOpacity : selected.key === 'wind' ? 35 : ['cells','cyclones','lightning'].includes(selected.key) ? 100 : settings.opacity : 100;
  return <><aside aria-label="Weather layers" className="absolute right-4 top-44 z-30 max-h-[calc(100%-17rem)] w-64 overflow-y-auto pr-1 text-white [scrollbar-width:none] max-sm:w-52">
    <div className="space-y-2">{layers.map(layer => <div key={layer.key} className="group relative flex h-10 items-center justify-end">
      <button type="button" aria-label={layer.label + ' settings'} aria-expanded={editing === layer.key} title={layer.label + ' settings'} disabled={!layer.active} onClick={() => setEditing(editing === layer.key ? null : layer.key)} className={`absolute right-0 flex h-10 w-10 items-center justify-center rounded-lg bg-[#0c202c]/90 text-[#b5c5cb] transition-opacity duration-200 hover:text-white ${layer.active ? 'opacity-100' : 'pointer-events-none invisible opacity-0'}`}><Settings2 className="h-4 w-4" /></button>
      <button type="button" aria-label={layer.label} title={layer.detail} aria-pressed={layer.active} onClick={() => { if (layer.active && editing === layer.key) setEditing(null); onChange({ ...layer.apply(), inspector: true }); }} className={`relative flex min-w-0 items-center justify-end gap-2 rounded-lg transition-transform duration-200 focus-visible:outline focus-visible:outline-[#a9d7d5] ${layer.active ? '-translate-x-12' : 'translate-x-0'}`}>
        <span className={`rounded-full bg-[#172c38]/90 px-3 py-1.5 text-[11px] transition-all duration-200 ${alwaysShowNames ? '' : 'translate-x-3 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:opacity-100'}`}>{layer.label}</span>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md border-2 shadow-lg ${layer.active ? 'border-[#a9d7d5]' : 'border-[#142d3b]'}`} style={{ background: layer.gradient }}><layer.icon aria-hidden="true" className="h-5 w-5 text-white drop-shadow-md" /></span>
      </button>
    </div>)}</div>
  </aside>
    {selected && <section aria-label={selected.label + ' settings'} className="absolute right-20 top-36 z-40 w-[min(18rem,calc(100%-7rem))] rounded-xl bg-[#0c202c] p-4 text-white shadow-xl">
      <div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">{selected.label}</h2><button type="button" aria-label="Close layer settings" onClick={()=>setEditing(null)}><X className="h-4 w-4" /></button></div>
      <p className="mb-4 text-xs text-slate-300">{selected.detail}</p>
      <button type="button" aria-pressed={selected.active} onClick={()=>onChange({...selected.apply(),inspector:true})} className="mb-4 w-full rounded-lg border border-white/20 py-2 text-sm">{selected.active?'Hide layer':'Show layer'}</button>
      {selected.key !== 'alerts' && <><label className="block text-xs">Opacity · {settings.layerOpacities?.[selected.key] ?? defaultOpacity}%
        <input aria-label={selected.label+' opacity'} type="range" min={0} max={100} step={5} value={settings.layerOpacities?.[selected.key] ?? defaultOpacity} onChange={event=>onChange({...settings,layerOpacities:{...settings.layerOpacities,[selected.key]:Number(event.target.value)}})} className="mt-3 w-full accent-[#a9d7d5]" />
      </label>
      <button type="button" onClick={()=>{const values={...settings.layerOpacities};delete values[selected.key];onChange({...settings,layerOpacities:values});}} className="mt-3 text-xs text-[#a9d7d5]">Reset opacity</button></>}
    </section>}
  </>;
}
