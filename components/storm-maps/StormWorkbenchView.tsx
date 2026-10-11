'use client';
import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import type mapboxgl from 'mapbox-gl';
import { CloudSun, CloudLightning, Tornado, Settings2, MapPin, Bookmark, X, Play, Pause, Maximize, ChevronDown } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { StormTimelineSettings } from './StormTimelineSettings';
import { StormWeatherRail } from './StormWeatherRail';
import { STRONGEST_STORM_SETTINGS, hurricaneViewSettings, type StormGLSettings } from '@/lib/storm-maps/gl-settings';
type Panel = 'focus' | 'storms' | 'territory' | 'layers' | 'saved' | null;
type Props = { timelineRange: { start: Date; end: Date }; onTimelineRange: (range: { start: Date; end: Date }) => void; onTimelineSpeed: (duration: number) => void; map: mapboxgl.Map; settings: StormGLSettings; onChange: (settings: StormGLSettings) => void; onSettings?: () => void; onArchive: (active: boolean) => void; alwaysShowNames?: boolean; ready: boolean; loading: boolean; error: string | null; playing: boolean; position: number; clock: string; rangeTitle: string; rangeLabels: { start: string; end: string }; onPlay: () => void; onScrub: (value: number) => void; onNow: () => void; legendRef: RefObject<HTMLDivElement | null>; renderSaved: () => ReactNode; renderTerritory: () => ReactNode; renderArchive: (onTerritory: () => void) => ReactNode; renderLayers: () => ReactNode };
export function StormWorkbenchView(props: Props) {
  const [panel, setPanel] = useState<Panel>('storms');
  const { onArchive } = props;
  useEffect(() => { onArchive(true); return () => onArchive(false); }, [onArchive]);
  // Discovery is the default workspace; campaign overlays use their own picker.
  const focus = props.settings.cyclones ? 'Tropical' : props.settings.hail || props.settings.cells || props.settings.shade.startsWith('hail-') ? 'Severe' : 'General';
  const open = (next: Panel) => { const target = panel === next ? null : next; setPanel(target); props.onArchive(target === 'storms'); };
  const apply = (settings: StormGLSettings) => { props.onChange(settings); props.onArchive(false); };
  const focusOptions = [
    { name: 'General', icon: CloudSun, detail: 'Temperatures, radar, wind and current weather.', settings: { ...STRONGEST_STORM_SETTINGS, shade: 'temperatures' as const, hail: false, cells: false, lightning: false, lightningThreats: false, outlook: false, reports: false, radar: true, wind: true, opacity: 100, radarOpacity: 70 } },
    { name: 'Severe', icon: CloudLightning, detail: 'Alerts, lightning, hail threats and storm tracking.', settings: { ...STRONGEST_STORM_SETTINGS, opacity: 100, radarOpacity: 100 } },
    { name: 'Tropical', icon: Tornado, detail: 'Satellite, cyclone tracks, winds and forecast cones.', settings: hurricaneViewSettings(props.settings, 'satellite') },
  ];
  return <>
    <header className="absolute right-4 top-4 z-30 flex h-14 flex-row-reverse items-center gap-3 rounded-xl bg-[#0c202c]/95 px-4 text-white shadow-xl max-sm:top-20 max-sm:gap-2 max-sm:px-3">
      <div className="ml-2 text-right leading-tight"><p className="text-[10px] font-semibold tracking-widest text-[#a9d7d5]">WOLFGRID</p><h1 className="text-lg font-semibold">Storm Maps</h1></div>
      <button type="button" aria-expanded={panel === 'focus'} onClick={() => open('focus')} className="flex items-center gap-3 rounded-md border-2 border-[#a9d7d5] bg-white px-3 py-2 text-sm font-medium text-[#162c38]">{focus} focus<ChevronDown className="h-4 w-4" /></button>
      <button type="button" title="Saved storm maps" aria-label="Saved storm maps" onClick={() => open('saved')} className="rounded p-1 text-[#b5c5cb] hover:text-white"><Bookmark className="h-5 w-5" /></button>
      <button type="button" title="Map settings" aria-label="Map settings" onClick={props.onSettings} className="rounded p-1 text-[#b5c5cb] hover:text-white"><Settings2 className="h-5 w-5" /></button>
    </header>
    <StormWeatherRail compact settings={props.settings} alwaysShowNames={false} onChange={apply} />
    <button type="button" aria-label="Find storm" aria-expanded={panel === 'storms'} onClick={() => open('storms')} className="absolute left-4 top-4 z-30 flex h-14 items-center gap-3 rounded-xl bg-[#a9d7d5] px-6 text-base font-semibold text-[#0c202c] shadow-xl"><MapPin className="h-5 w-5" />Find storm</button>
    {panel && <section aria-label={`${panel} panel`} tabIndex={0} className="dark absolute left-4 top-20 z-30 max-h-[calc(100%-12rem)] w-[min(23rem,calc(100%-7rem))] overflow-y-auto rounded-2xl bg-[#0c202c]/95 p-5 text-white shadow-xl max-lg:top-36" style={{ overscrollBehavior: 'contain', touchAction: 'pan-y' }}>
      <div className="mb-4 flex items-center justify-between"><h2 className="text-base font-semibold">{{focus:'Weather focus',storms:'Find storms',territory:'Storm territories',layers:'Weather layers',saved:'Saved storm maps'}[panel]}</h2><button type="button" aria-label="Close map panel" onClick={() => open(null)} className="rounded-full bg-white/10 p-2"><X className="h-4 w-4" /></button></div>
      {panel === 'focus' && <><p className="mb-4 text-sm leading-relaxed text-[#b5c5cb]">Choose the weather most relevant to your work.</p><div className="grid gap-2">{focusOptions.map(option => <button key={option.name} type="button" aria-pressed={focus === option.name} onClick={() => { apply({ ...option.settings, units: props.settings.units }); setPanel(null); }} className={`rounded-xl border-2 p-4 text-left ${focus === option.name ? 'border-[#a9d7d5] bg-black/20' : 'border-white/15 hover:border-white/40'}`}><span className="flex justify-between text-lg font-semibold">{option.name}<option.icon className="h-6 w-6 text-[#a9d7d5]" /></span><span className="mt-2 block text-sm text-[#b5c5cb]">{option.detail}</span></button>)}</div></>}
      {(panel === 'storms' || panel === 'saved') && <nav aria-label="Storm lists" className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-white/10 p-1"><button type="button" aria-pressed={panel === 'storms'} onClick={() => {setPanel('storms');props.onArchive(true);}} className={`rounded-md px-2 py-2 text-xs ${panel === 'storms' ? 'bg-[#a9d7d5] text-[#0c202c]' : ''}`}>Recent storms</button><button type="button" aria-pressed={panel === 'saved'} onClick={() => {setPanel('saved');props.onArchive(false);}} className={`rounded-md px-2 py-2 text-xs ${panel === 'saved' ? 'bg-[#a9d7d5] text-[#0c202c]' : ''}`}>Saved territories</button></nav>}
      {panel === 'storms' && props.renderArchive(() => open('territory'))}
      {panel === 'territory' && props.renderTerritory()}
      {panel === 'layers' && props.renderLayers()}
      {panel === 'saved' && <>{props.renderSaved()}<button type="button" onClick={() => open('territory')} className="mt-4 w-full rounded-lg bg-[#a9d7d5] py-3 text-sm font-semibold text-[#0c202c]">Create storm territory</button></>}
    </section>}
    <aside aria-label="Weather legends" className="absolute bottom-5 right-24 z-20 max-h-[25%] w-[min(21rem,calc(100%-7rem))] overflow-y-auto rounded-lg bg-white p-3 text-slate-800 shadow-xl max-md:bottom-28 max-md:w-48"><div ref={props.legendRef} className="text-xs" /><p className="mt-1 text-[9px] text-slate-500">Weather estimates · Vaisala Xweather</p></aside>
    <div className="absolute bottom-5 left-1/2 z-30 flex w-[min(36rem,calc(100%-10rem))] -translate-x-1/2 items-center gap-3 rounded-2xl bg-[#0c202c]/95 px-4 py-3 text-white shadow-xl max-md:left-4 max-md:w-[calc(100%-7rem)] max-md:translate-x-0">
      <button type="button" aria-label={props.playing ? 'Pause weather animation' : 'Play weather animation'} disabled={!props.ready} onClick={props.onPlay} className="rounded-full bg-white p-2 text-[#0c202c] disabled:opacity-40">{props.playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}</button>
      <StormTimelineSettings range={props.timelineRange} duration={props.settings.speed} mode={props.settings.mode} onRange={props.onTimelineRange} onSpeed={props.onTimelineSpeed} />
      <div className="min-w-0 flex-1"><div className="mb-2 flex items-center justify-between text-xs"><span>{props.clock}</span><span className="truncate px-2 text-[10px] text-[#b5c5cb]">{props.rangeTitle}</span><button onClick={props.onNow} className="text-[#a9d7d5]">Now</button></div><Slider aria-label="Weather timeline" min={0} max={100} step={1} value={[props.position]} onValueChange={value => props.onScrub(value[0])} /><div className="mt-1 flex justify-between text-[9px] text-[#b5c5cb]"><span>{props.rangeLabels.start}</span><span>{props.rangeLabels.end}</span></div></div>
      <button type="button" aria-label="Toggle fullscreen map" onClick={() => { const node = props.map.getContainer().parentElement; if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); else void node?.requestFullscreen().catch(() => {}); }} className="rounded-full bg-white/10 p-2"><Maximize className="h-4 w-4" /></button>
    </div>
    {(props.error || props.loading) && <p role={props.error ? 'alert' : 'status'} className="absolute bottom-28 left-1/2 z-40 -translate-x-1/2 rounded-lg bg-[#0c202c]/95 px-4 py-2 text-xs text-white">{props.error || 'Loading weather…'}</p>}
  </>;
}
