'use client';
import { CloudHail, CloudLightning, Tornado, Wind, Radar, Zap, Waves, Thermometer, Satellite, ShieldAlert, Cloud } from 'lucide-react';
import type { StormGLSettings } from '@/lib/storm-maps/gl-settings';
import { hailViewSettings, hurricaneViewSettings } from '@/lib/storm-maps/gl-settings';
type Props = { settings: StormGLSettings; onChange: (settings: StormGLSettings) => void; alwaysShowNames?: boolean; onSettings?: () => void; compact?: boolean };
export function StormWeatherRail({ settings, onChange, alwaysShowNames = true }: Props) {
  const shade = (id: StormGLSettings['shade']) => ({ ...settings, shade: settings.shade === id ? 'none' as const : id, inspector: true });
  const layers = [
    { label: 'Radar', icon: Radar, gradient: 'linear-gradient(130deg,#0e4422,#65bb16,#ffdc00,#eb1717)', detail: 'Precipitation radar; model precipitation in forecast mode.', active: settings.radar, apply: () => ({ ...settings, radar: !settings.radar }) },
    { label: 'Satellite', icon: Satellite, gradient: 'linear-gradient(140deg,#283347,#f5f5f5,#5b6f89)', detail: 'Infrared cloud-top temperature imagery, past 6 hours.', active: settings.shade === 'satellite-infrared-color', apply: () => ({ ...settings, shade: 'satellite-infrared-color' as const, mode: 'history' as const, historyHours: 6 }) },
    { label: 'Alerts', icon: ShieldAlert, gradient: 'linear-gradient(140deg,#492b62,#b10819,#efdd39)', detail: 'Published official weather warnings and watches.', active: settings.alerts, apply: () => ({ ...settings, alerts: !settings.alerts }) },
    { label: 'Temperatures', icon: Thermometer, gradient: 'linear-gradient(140deg,#391ea8,#02bdfb,#1cff25,#fbef22,#ef1515)', detail: 'Air temperature. Hover for measurements.', active: settings.shade === 'temperatures', apply: () => shade('temperatures') },
    { label: 'Wind speed', icon: Wind, gradient: 'linear-gradient(140deg,#2738b2,#00d5f4,#68ee24)', detail: 'Sustained wind speed.', active: settings.shade === 'wind-speeds', apply: () => shade('wind-speeds') },
    { label: 'Wind gusts', icon: Wind, gradient: 'linear-gradient(140deg,#222f93,#20bf6f,#fbbb14,#dc2828)', detail: 'Short bursts of wind, separate from sustained speed.', active: settings.shade === 'wind-gusts', apply: () => shade('wind-gusts') },
    { label: 'Wind particles', icon: Waves, gradient: 'linear-gradient(140deg,#152735,#467d71,#cb951e)', detail: 'Animated wind direction and speed.', active: settings.wind, apply: () => ({ ...settings, wind: !settings.wind }) },
    { label: 'Lightning', icon: Zap, gradient: 'linear-gradient(140deg,#483691,#db6123,#ffc72b)', detail: 'Observed lightning flashes and strikes.', active: settings.lightning, apply: () => ({ ...settings, lightning: !settings.lightning }) },
    { label: 'Hail', icon: CloudHail, gradient: 'linear-gradient(140deg,#593bad,#19cbd6,#dede18,#e411c9)', detail: 'Maximum estimated hail size over the past 24 hours.', active: settings.shade === 'hail-size-max', apply: () => hailViewSettings(settings, 'history') },
    { label: 'Thunder', icon: CloudLightning, gradient: 'linear-gradient(140deg,#294d25,#83e245,#fbdc32)', detail: 'Storm cells, movement and lightning threats.', active: settings.cells, apply: () => ({ ...settings, cells: !settings.cells, lightningThreats: !settings.cells, mode: 'live' as const }) },
    { label: 'Hurricane', icon: Tornado, gradient: 'linear-gradient(140deg,#283873,#e55cbb,#e03b20)', detail: 'Tropical cyclones with satellite imagery.', active: settings.cyclones, apply: () => hurricaneViewSettings(settings, 'satellite') },
    { label: 'Cloud cover', icon: Cloud, gradient: 'linear-gradient(140deg,#637386,#e7edf2)', detail: 'Cloud coverage percentage.', active: settings.shade === 'cloud-cover', apply: () => shade('cloud-cover') },
  ];
  return <aside aria-label="Weather layers" className="absolute right-4 top-44 z-30 max-h-[calc(100%-17rem)] w-44 overflow-y-auto pr-1 text-white [scrollbar-width:none] max-sm:w-36">
    <div className="mb-2 flex justify-end gap-1">{(['live','history'] as const).map(mode => <button key={mode} type="button" aria-pressed={settings.mode === mode} onClick={() => onChange({ ...settings, mode, ...(mode === 'live' && settings.shade.startsWith('hail-') ? { shade: 'none', hail: true } : {}) })} className={`rounded-full px-3 py-1.5 text-[10px] ${settings.mode === mode ? 'bg-[#a9d7d5] text-[#0c202c]' : 'bg-[#0c202c]/90'}`}>{mode === 'live' ? 'Live map' : 'Past map'}</button>)}</div>
    <div className="space-y-2">{layers.map(layer => <button key={layer.label} type="button" aria-label={layer.label} title={layer.detail} aria-pressed={layer.active} onClick={() => onChange({ ...layer.apply(), inspector: true })} className="group flex w-full items-center justify-end gap-2 rounded-lg focus-visible:outline focus-visible:outline-[#a9d7d5]">
      <span className={`rounded-full bg-[#172c38]/90 px-3 py-1.5 text-[11px] transition-opacity ${alwaysShowNames ? '' : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100'}`}>{layer.label}</span>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md border-2 shadow-lg ${layer.active ? 'border-[#a9d7d5]' : 'border-[#142d3b]'}`} style={{ background: layer.gradient }}><layer.icon aria-hidden="true" className="h-5 w-5 text-white drop-shadow-md" /></span>
    </button>)}</div>
  </aside>;
}
