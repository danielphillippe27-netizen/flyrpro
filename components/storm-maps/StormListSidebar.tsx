'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { handleWheelScrollContainer } from '@/lib/scrollContainer';
export function StormListSidebar({collapsed,onCollapse,tab,onTab,children,onCreate}:{
 collapsed:boolean;onCollapse:(value:boolean)=>void;tab:'storms'|'saved'|'territory';
 onTab:(tab:'storms'|'saved')=>void;children:ReactNode;onCreate:()=>void;
}){
 const scroll=useRef<HTMLDivElement>(null);
 useEffect(()=>{const node=scroll.current;if(!node)return;const wheel=(event:WheelEvent)=>handleWheelScrollContainer(event,node);node.addEventListener('wheel',wheel,{passive:false});return()=>node.removeEventListener('wheel',wheel);},[]);
 return <aside aria-label="Storm list" className="absolute inset-y-0 left-0 z-30 flex flex-col overflow-hidden border-r border-border bg-white text-foreground transition-[width] duration-200 ease-out dark:bg-sidebar" style={{width:collapsed?36:280}}>
   {collapsed && <button type="button" onClick={()=>onCollapse(false)} aria-label="Show storm list" title="Show storm list" className="absolute left-0 top-0 z-10 flex h-[49px] w-9 items-center justify-center border-b border-border bg-white text-muted-foreground hover:text-foreground dark:bg-[#0f0f10]"><ChevronsRight className="h-3.5 w-3.5" /></button>}
   <div className={'flex h-full w-[280px] flex-col transition-opacity duration-200 '+(collapsed?'pointer-events-none opacity-0':'opacity-100')} inert={collapsed}>
    <header className="relative border-b border-border p-3">
      <button type="button" aria-label="Hide storm list" title="Hide storm list" onClick={()=>onCollapse(true)} className="absolute right-3 top-1 flex h-[18px] w-[18px] items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"><ChevronsLeft className="h-3.5 w-3.5" /></button>
      <h2 className="mb-2 pr-8 text-sm font-semibold">Find storm</h2>
      <button type="button" onClick={onCreate} className="w-full rounded-md bg-primary py-2 text-xs font-semibold text-primary-foreground">Create storm territory</button>
    </header>
    <nav aria-label="Storm lists" className="mx-3 mt-2 grid h-8 grid-cols-2 gap-1 rounded-lg bg-muted/50 p-0.5 dark:bg-muted/30">
      {(['storms','saved'] as const).map(value=><button key={value} type="button" aria-pressed={tab===value} onClick={()=>onTab(value)} className={'rounded-md text-xs font-medium '+(tab===value?'bg-background shadow-sm':'text-muted-foreground hover:text-foreground')}>{value==='storms'?'Recent storms':'Saved territories'}</button>)}
    </nav>
    <div ref={scroll} className="min-h-0 flex-1 overflow-y-auto px-3 py-3" style={{overscrollBehavior:'contain',touchAction:'pan-y'}}>{children}</div>
   </div>
 </aside>;
}
