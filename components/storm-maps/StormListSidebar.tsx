'use client';
import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { ChevronsLeft, ChevronsRight, X } from 'lucide-react';
import { handleWheelScrollContainer } from '@/lib/scrollContainer';
export function StormListSidebar({collapsed,onCollapse,tab,onTab,children,onCreate,mobileCampaign=false,title}:{
 mobileCampaign?:boolean;title?:string;
 collapsed:boolean;onCollapse:(value:boolean)=>void;tab:'storms'|'saved'|'territory';
 onTab:(tab:'storms'|'saved')=>void;children:ReactNode;onCreate:()=>void;
}){
 const scroll=useRef<HTMLDivElement>(null);
 useEffect(()=>{const node=scroll.current;if(!node)return;const wheel=(event:WheelEvent)=>handleWheelScrollContainer(event,node);node.addEventListener('wheel',wheel,{passive:false});return()=>node.removeEventListener('wheel',wheel);},[]);
 return <aside aria-label="Storm list" className={`absolute inset-x-0 bottom-0 z-30 flex h-[58%] min-h-0 w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-white text-foreground shadow-2xl md:inset-x-auto md:inset-y-0 md:left-0 md:h-auto md:w-[var(--storm-sidebar-width)] md:rounded-none md:border-r md:shadow-none dark:bg-sidebar ${collapsed ? "max-md:hidden" : ""}`} style={{ position: 'absolute', zIndex: mobileCampaign ? 50 : 30, ...(mobileCampaign ? { display: collapsed ? 'none' : 'flex', top: 'auto', bottom: 0, left: 0, right: 0, width: '100%', height: '58%' } : {}), '--storm-sidebar-width': `${collapsed ? 36 : 280}px` } as CSSProperties}>
   {collapsed && <button type="button" onClick={()=>onCollapse(false)} aria-label="Show storm list" title="Show storm list" className="absolute left-0 top-0 z-10 flex h-[49px] w-9 items-center justify-center border-b border-border bg-white text-muted-foreground hover:text-foreground dark:bg-[#0f0f10]"><ChevronsRight className="h-3.5 w-3.5" /></button>}
   <div className={'flex h-full min-h-0 w-full md:w-[280px] flex-col overflow-hidden transition-opacity duration-200 '+(collapsed?'pointer-events-none opacity-0':'opacity-100')} inert={collapsed} style={mobileCampaign ? { width: '100%' } : undefined}>
    <header className="relative shrink-0 border-b border-border p-3">
      <button type="button" aria-label="Hide storm list" title="Hide storm list" onClick={()=>onCollapse(true)} className="absolute right-2 top-1 flex h-11 w-11 md:h-[18px] md:w-[18px] items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-5 w-5 md:hidden" /><ChevronsLeft className="hidden h-3.5 w-3.5 md:block" /></button>
      <h2 className="mb-2 min-h-8 md:min-h-0 pr-10 text-sm font-semibold">{title ?? (mobileCampaign ? tab==='territory'?'Campaign area':tab==='saved'?'Saved storms':'Find storm' : 'Find storm')}</h2>
      {!mobileCampaign && <button type="button" onClick={onCreate} className="min-h-11 md:min-h-0 w-full rounded-md bg-primary py-2 text-xs font-semibold text-primary-foreground">Create storm territory</button>}
    </header>
    {!mobileCampaign && <nav aria-label="Storm lists" className="mx-3 mt-2 grid h-11 md:h-8 shrink-0 grid-cols-2 gap-1 rounded-lg bg-muted/50 p-0.5 dark:bg-muted/30">
      {(['storms','saved'] as const).map(value=><button key={value} type="button" aria-pressed={tab===value} onClick={()=>onTab(value)} className={'rounded-md text-xs font-medium '+(tab===value?'bg-background shadow-sm':'text-muted-foreground hover:text-foreground')}>{value==='storms'?'Recent storms':mobileCampaign?'Saved storms':'Saved territories'}</button>)}
    </nav>}
    <div ref={scroll} role="region" aria-label="Find storm content" tabIndex={collapsed?-1:0} className="min-h-0 flex-1 overflow-y-auto px-3 py-3" style={{overscrollBehavior:'contain',touchAction:'pan-y',scrollbarGutter:'stable'}}>{children}</div>
   </div>
 </aside>;
}
