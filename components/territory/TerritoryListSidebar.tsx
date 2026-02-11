'use client';

import { useState } from 'react';
import { Plus, Search, PanelLeftClose, PanelLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

type StatusTab = 'active' | 'completed';

interface TerritoryListSidebarProps {
  onNewTerritory?: () => void;
  collapsed?: boolean;
  hoverExpanded?: boolean;
  onToggleCollapse?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  width?: number;
  stripWidth?: number;
}

export function TerritoryListSidebar({
  onNewTerritory,
  collapsed = false,
  hoverExpanded = false,
  onToggleCollapse,
  onMouseEnter,
  onMouseLeave,
  width = 280,
  stripWidth = 52,
}: TerritoryListSidebarProps) {
  const [search, setSearch] = useState('');
  const [statusTab, setStatusTab] = useState<StatusTab>('active');

  const isStripOnly = collapsed && !hoverExpanded;
  const showFullContent = !isStripOnly;

  return (
    <aside
      className={cn(
        'shrink-0 flex flex-col border-r border-border bg-muted/30 dark:bg-sidebar/50 transition-[width] duration-200 ease-out overflow-hidden',
      )}
      style={{ width }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {isStripOnly ? (
        <div className="flex flex-col items-center justify-center py-4 h-full gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleCollapse}
            aria-label="Show territory list"
            title="Show territory list"
          >
            <PanelLeft className="w-5 h-5" />
          </Button>
          <span
            className="text-[10px] font-medium text-muted-foreground select-none"
            style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
          >
            Territory
          </span>
        </div>
      ) : (
        <>
          <div className="p-4 pb-4 border-b border-border">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className="text-lg font-bold text-foreground truncate min-w-0">Territory</h2>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                onClick={onToggleCollapse}
                aria-label="Hide territory list"
                title="Hide territory list"
              >
                <PanelLeftClose className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder="Search territories..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-9 text-sm bg-background border-border"
                />
              </div>
              <Button
                size="icon"
                className="h-9 w-9 shrink-0 bg-red-600 text-white hover:bg-red-700 rounded-md"
                onClick={onNewTerritory}
                aria-label="Add territory"
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="flex-1 flex flex-col min-h-0 px-3 pt-3">
            <Tabs value={statusTab} onValueChange={(v) => setStatusTab(v as StatusTab)} className="flex flex-col flex-1 min-h-0 w-full">
              <TabsList className="w-full grid grid-cols-2 h-9 bg-muted/50 dark:bg-muted/30 p-0.5 rounded-lg">
                <TabsTrigger value="active" className="text-xs font-medium rounded-md">
                  Active (0)
                </TabsTrigger>
                <TabsTrigger value="completed" className="text-xs font-medium rounded-md">
                  Completed (0)
                </TabsTrigger>
              </TabsList>
              <TabsContent value="active" className="mt-0 flex-1 min-h-0 focus-visible:outline-none data-[state=inactive]:hidden">
                <div className="overflow-auto min-h-0 pt-0 -mx-3 px-3">
                  <div className="px-3 py-4 text-sm text-muted-foreground">No territories yet</div>
                </div>
              </TabsContent>
              <TabsContent value="completed" className="mt-0 flex-1 min-h-0 focus-visible:outline-none data-[state=inactive]:hidden">
                <div className="overflow-auto min-h-0 pt-0 -mx-3 px-3">
                  <div className="px-3 py-4 text-sm text-muted-foreground">No completed territories</div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </>
      )}
    </aside>
  );
}
