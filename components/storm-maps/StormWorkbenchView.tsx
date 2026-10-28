'use client';
import { useCallback, useEffect, useState, type ReactNode, type RefObject } from 'react';
import type mapboxgl from 'mapbox-gl';
import { Settings2, MapPin, Bookmark, X, Layers, Scan, Pencil, Info, Check } from 'lucide-react';
import { StormListSidebar } from './StormListSidebar';
import { StormTimelineSettings } from './StormTimelineSettings';
import { StormFullscreenButton } from './StormFullscreenButton';
import { StormWeatherRail } from './StormWeatherRail';
import type { StormGLSettings } from '@/lib/storm-maps/gl-settings';
type Panel = 'storms' | 'territory' | 'layers' | 'saved' | null;
export type StormWindActions = { inspect: () => void; review: () => void };
type Props = { archivedWind?: boolean; mobileCampaign?: boolean; initiallyOpenDiscovery?: boolean; drawingRequest?: number; selectedStorm?: boolean; onCreateTerritory?: (selection: 'draw' | 'weather') => void; onSidebarWidth?: (width: number) => void; timelineRange: { start: Date; end: Date }; onTimelineRange: (range: { start: Date; end: Date }) => void; onTimelineSpeed: (duration: number) => void; map: mapboxgl.Map; settings: StormGLSettings; onChange: (settings: StormGLSettings) => void; onSettings?: () => void; onArchive: (active: boolean) => void; alwaysShowNames?: boolean; ready: boolean; loading: boolean; error: string | null; playing: boolean; position: number; clock: string; rangeTitle: string; rangeLabels: { start: string; end: string }; onPlay: () => void; onScrub: (value: number) => void; onNow: () => void; legendRef: RefObject<HTMLDivElement | null>; renderSaved: () => ReactNode; renderTerritory: (onSelectionReady?: () => void) => ReactNode; renderArchive: (onTerritory: () => void, browseOnly?: boolean, onSelected?: () => void, windActions?: StormWindActions) => ReactNode; renderLayers: () => ReactNode };
import { useMobileLayout } from '@/lib/hooks/useMobileLayout';
export function StormWorkbenchView(props: Props) {
  const narrowLayout = useMobileLayout();
  const isMobile = props.mobileCampaign || narrowLayout;
  const [panel, setPanel] = useState<Panel>('storms');
  const [collapsed, setCollapsed] = useState(false);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(props.initiallyOpenDiscovery ?? false);
  const [mobileLayersOpen, setMobileLayersOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [tool, setTool] = useState<'draw' | 'weather' | null>(null);
  const [draftRevision, setDraftRevision] = useState(0);
  const [selectionReady, setSelectionReady] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const selectionComplete = useCallback(() => { setSelectionReady(true); setPanel('territory'); setMobilePanelOpen(true); }, []);
  const selectWeather = props.onCreateTerritory;
  const stormSelected = useCallback(() => { selectWeather?.('weather'); setMobilePanelOpen(false); setTool('weather'); setDraftRevision(value => value + 1); setSelectionReady(false); setShowInfo(true); }, [selectWeather]);
  const inspectWind = useCallback(() => { setPanel('storms'); setMobilePanelOpen(false); setTool(null); setSelectionReady(false); }, []);
  const reviewWind = useCallback(() => { setPanel('storms'); setMobilePanelOpen(true); }, []);
  const findStorm = () => { setShowInfo(false); setPanel('storms'); setMobilePanelOpen(true); };
  const iconClass = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/90 text-slate-950 shadow-md backdrop-blur-md dark:bg-slate-900/90 dark:text-white';
  const dashboard = panel === 'storms' || panel === 'saved' || panel === 'territory';
  const sidebarCollapsed = isMobile ? !mobilePanelOpen : collapsed;
  const sidebarWidth = isMobile ? 0 : dashboard ? collapsed ? 36 : 280 : 0;
  const { onSidebarWidth, onArchive, onCreateTerritory, drawingRequest } = props;
  useEffect(() => { onSidebarWidth?.(sidebarWidth); return () => onSidebarWidth?.(0); }, [onSidebarWidth, sidebarWidth]);
  useEffect(() => { onArchive(true); return () => onArchive(false); }, [onArchive]);
  const collapse = (value: boolean) => { if (isMobile) setMobilePanelOpen(!value); else setCollapsed(value); };
  const open = (next: Panel) => {
    const target = panel === next && !sidebarCollapsed ? null : next;
    setPanel(target);
    setCollapsed(false);
    setMobilePanelOpen(target !== null);
    setMobileLayersOpen(false);
    props.onArchive(target === 'storms' || target === 'territory');
  };
  const createTerritory = (selection: 'draw' | 'weather' = 'draw') => {
    props.onCreateTerritory?.(selection);
    setTool(selection); setDraftRevision(value => value + 1); setSelectionReady(false);
    setPanel('territory'); setCollapsed(false); setMobilePanelOpen(!props.mobileCampaign); setMobileLayersOpen(false); props.onArchive(true);
  };
  useEffect(() => {
    if (!drawingRequest) return;
    onCreateTerritory?.('draw');
    setTool('draw'); setDraftRevision(value => value + 1); setSelectionReady(false);
    setPanel('territory'); setCollapsed(false); setMobilePanelOpen(!props.mobileCampaign); setMobileLayersOpen(false);
    onArchive(true);
  }, [drawingRequest, onCreateTerritory, onArchive, props.mobileCampaign]);
  const apply = (settings: StormGLSettings) => { props.onChange(settings); props.onArchive(false); };
  const mobilePanelVisible = mobilePanelOpen && dashboard;
  return <>
    {props.mobileCampaign && <>
      <nav aria-label="Storm map tools" className="storm-mobile-toolbar absolute right-3 top-2 z-40 flex flex-col items-end gap-3">
        <button type="button" onClick={findStorm} aria-expanded={mobilePanelVisible && panel === 'storms' && !showInfo} className="flex h-11 items-center gap-2 rounded-full bg-white/90 px-4 text-sm font-semibold text-slate-950 shadow-md backdrop-blur-md dark:bg-slate-900/90 dark:text-white"><MapPin className="h-5 w-5" />Find storm</button>
        <div className="flex flex-col items-end gap-3">
        <button type="button" aria-label="Map settings" onClick={props.onSettings} className={iconClass}><Settings2 className="h-5 w-5" /></button>
        <button type="button" aria-label="Saved storm maps" onClick={() => open('saved')} className={iconClass}><Bookmark className="h-5 w-5" /></button>
        </div>
      </nav>
      {props.selectedStorm && <nav aria-label="Storm area tools" className="storm-mobile-rail absolute right-3 top-32 z-40 flex flex-col gap-3">
        <button type="button" aria-label="Select hail area" aria-pressed={tool === 'weather'} onClick={() => createTerritory('weather')} className={iconClass} style={tool === 'weather' ? {background:'#ff293e',color:'white'} : undefined}><Scan className="h-5 w-5" /></button>
        <button type="button" aria-label="Draw campaign area" aria-pressed={tool === 'draw'} onClick={() => createTerritory('draw')} className={iconClass} style={tool === 'draw' ? {background:'#ff293e',color:'white'} : undefined}><Pencil className="h-5 w-5" /></button>
        <button type="button" aria-label="Storm info" aria-expanded={mobilePanelVisible && panel === 'storms' && showInfo} onClick={() => { setShowInfo(true); setPanel('storms'); setMobilePanelOpen(!(panel === 'storms' && showInfo && mobilePanelOpen)); }} className={iconClass}><Info className="h-5 w-5" /></button>
        {selectionReady && <button type="button" aria-label="Review campaign area" onClick={selectionComplete} className={iconClass}><Check className="h-5 w-5" /></button>}
      </nav>}
      {(tool || props.archivedWind) && !mobilePanelVisible && !selectionReady && <p role="status" className="pointer-events-none absolute bottom-8 left-3 right-3 z-20 rounded-xl bg-white/90 px-4 py-3 text-center text-sm text-slate-950 shadow-md dark:bg-slate-900/90 dark:text-white">{props.archivedWind ? 'Tap a coloured wind area to select its gust zone.' : tool === 'draw' ? 'Tap to draw. Tap the first point to finish.' : 'Tap a coloured hail area to select its zone.'}</p>}
    </>}
    {!props.mobileCampaign && <nav aria-label="Storm map tools" className="absolute inset-x-2 top-2 z-40 flex items-center gap-1 rounded-xl border border-border dark:border-white/10 bg-white/95 dark:bg-[#0c202c]/95 p-1 text-slate-900 dark:text-white shadow-xl" style={props.mobileCampaign ? undefined : { display: isMobile ? undefined : 'none' }}>
      <button type="button" aria-expanded={mobilePanelVisible && (panel === 'storms' || panel === 'territory')} onClick={() => { if (panel === 'territory' && sidebarCollapsed) collapse(false); else open('storms'); }} className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold"><MapPin className="h-4 w-4" />{panel === 'territory' && sidebarCollapsed ? 'Campaign area' : 'Find storm'}</button>
      {!props.mobileCampaign && <button type="button" aria-expanded={mobileLayersOpen} onClick={() => { setMobileLayersOpen(value => !value); setMobilePanelOpen(false); }} className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold"><Layers className="h-4 w-4" />Layers</button>}
      <button type="button" aria-label="Saved storm maps" aria-expanded={mobilePanelVisible && panel === 'saved'} onClick={() => open('saved')} className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold"><Bookmark className="h-4 w-4" />{props.mobileCampaign && 'Saved storms'}</button>
      <button type="button" aria-label="Map settings" onClick={props.onSettings} className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold"><Settings2 className="h-4 w-4" />{props.mobileCampaign && 'Map settings'}</button>
    </nav>}
    {!props.mobileCampaign && mobileLayersOpen && <StormWeatherRail compact settings={props.settings} alwaysShowNames={false} onChange={apply} mobileOpen={mobileLayersOpen} onMobileClose={() => setMobileLayersOpen(false)} />}
    {!props.mobileCampaign && (!dashboard || collapsed) && <button type="button" aria-label="Find storm" aria-expanded={panel === 'storms' && !collapsed} onClick={() => { if (collapsed && panel === 'storms') setCollapsed(false); else open('storms'); }} className="absolute left-12 top-4 z-30 hidden h-14 items-center gap-3 rounded-xl bg-[#a9d7d5] px-6 text-base font-semibold text-[#0c202c] shadow-xl md:flex"><MapPin className="h-5 w-5" />Find storm</button>}
    <div hidden={!dashboard}>
      <StormListSidebar title={props.mobileCampaign && panel === 'storms' && showInfo ? 'Storm info' : undefined} mobileCampaign={props.mobileCampaign} collapsed={sidebarCollapsed} onCollapse={collapse} tab={dashboard ? panel as 'storms'|'saved'|'territory' : 'storms'} onTab={value => { setPanel(value); props.onArchive(value === 'storms'); }} onCreate={() => createTerritory('draw')}>
        {/* Archive stays mounted so closing the list preserves selected map layers. */}
        <div hidden={panel !== 'storms'}>{props.renderArchive(() => createTerritory('weather'), props.mobileCampaign ? !showInfo : undefined, props.mobileCampaign ? stormSelected : undefined, isMobile ? {inspect:inspectWind,review:reviewWind} : undefined)}</div>
        {panel === 'saved' && props.renderSaved()}
        {(props.mobileCampaign ? tool !== null : panel === 'territory') && <div key={props.mobileCampaign ? draftRevision : 'desktop'} hidden={panel !== 'territory'}>{props.renderTerritory(props.mobileCampaign ? selectionComplete : undefined)}</div>}
      </StormListSidebar>
    </div>
    {panel && !dashboard && <section aria-label={`${panel} panel`} tabIndex={0} className="absolute left-4 top-20 z-30 max-h-[calc(100%-12rem)] w-[min(23rem,calc(100%-2rem))] overflow-y-auto rounded-2xl border border-border dark:border-white/10 bg-white/95 dark:bg-[#0c202c]/95 p-5 text-slate-900 dark:text-white shadow-xl" style={{ overscrollBehavior: 'contain', touchAction: 'pan-y' }}>
      <div className="mb-4 flex items-center justify-between"><h2 className="text-base font-semibold">Weather layers</h2><button type="button" aria-label="Close map panel" onClick={() => open(null)} className="rounded-full bg-slate-900/5 dark:bg-white/10 p-2"><X className="h-4 w-4" /></button></div>
      {panel === 'layers' && props.renderLayers()}
    </section>}
    {!props.mobileCampaign && !props.archivedWind && <aside aria-label="Weather legends" className={`absolute bottom-44 left-2 z-20 max-h-[25%] max-w-[calc(100%-5rem)] overflow-y-auto rounded-lg bg-white p-2 text-slate-800 shadow-xl md:bottom-28 md:left-auto md:right-24 md:w-72 ${mobilePanelVisible || mobileLayersOpen ? 'max-md:hidden' : ''}`}>
      <button type="button" aria-expanded={legendOpen} onClick={() => setLegendOpen(value => !value)} className="min-h-11 text-xs font-medium md:hidden">{legendOpen ? 'Hide legend' : 'Show legend'}</button>
      <div className={legendOpen ? '' : 'max-md:hidden'}><div ref={props.legendRef} className="text-xs" /><p className="mt-1 text-[9px] text-slate-500">Weather estimates · Vaisala Xweather</p></div>
    </aside>}
    {!props.mobileCampaign && <nav aria-label="Map settings and timeline" className="absolute right-4 top-20 z-40 flex items-center gap-2 rounded-2xl border border-border bg-white/95 p-2 text-slate-900 shadow-xl dark:border-white/10 dark:bg-[#0c202c]/95 dark:text-white md:top-4">
      <button type="button" aria-label="Map settings" onClick={props.onSettings} className="hidden h-11 w-11 items-center justify-center rounded-full hover:bg-slate-900/5 dark:hover:bg-white/10 md:flex"><Settings2 className="h-5 w-5" /></button>
      <StormTimelineSettings range={props.timelineRange} duration={props.settings.speed} settings={props.settings} onChange={props.onChange} onRange={props.onTimelineRange} onSpeed={props.onTimelineSpeed} />
      <StormFullscreenButton map={props.map} />
    </nav>}
    {(props.error || props.loading) && <p role={props.error ? 'alert' : 'status'} className="storm-mobile-status pointer-events-none absolute left-2 right-2 top-16 z-40 rounded-lg bg-white/95 dark:bg-[#0c202c]/95 px-4 py-2 text-xs text-slate-900 dark:text-white md:bottom-28 md:left-1/2 md:right-auto md:top-auto md:-translate-x-1/2">{props.error || 'Loading weather…'}</p>}
  </>;
}
