'use client';

import { useState } from 'react';
import { DollarSign, Ellipsis, House, QrCode, Settings2 } from 'lucide-react';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

const tools = [
  { value: 'qr', label: 'QR Codes', icon: QrCode },
  { value: 'finance', label: 'Finance', icon: DollarSign },
  { value: 'homes', label: 'Homes', icon: House },
  { value: 'configure', label: 'Settings', icon: Settings2 },
];

export function FarmNavigation({ activeTab, onSelect }: { activeTab: string; onSelect: (tab: string) => void }) {
  const [open, setOpen] = useState(false);
  const selectedTool = tools.find(tool => tool.value === activeTab);

  return <div className="shrink-0 space-y-3">
    <div className="flex max-w-full items-center gap-1">
      <TabsList aria-label="Farm navigation" className="min-w-0 shrink justify-start overflow-x-auto">
        <TabsTrigger value="overview">Dashboard</TabsTrigger>
        <TabsTrigger value="map">Map</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
        <TabsTrigger value="leads">Contacts</TabsTrigger>
        <TabsTrigger value="notes">Notes</TabsTrigger>
        {tools.map(tool => <TabsTrigger key={tool.value} value={tool.value} className="hidden">{tool.label}</TabsTrigger>)}
      </TabsList>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button type="button" className={cn('flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', selectedTool ? 'bg-muted text-foreground dark:bg-tabs-active' : 'text-muted-foreground')}>
            <Ellipsis className="h-4 w-4" aria-hidden="true" />More
          </button>
        </DialogTrigger>
        <DialogContent className="top-auto bottom-0 max-h-[85dvh] max-w-full translate-y-0 overflow-y-auto rounded-t-3xl rounded-b-none px-5 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:top-1/2 sm:bottom-auto sm:max-w-lg sm:-translate-y-1/2 sm:rounded-2xl sm:p-6">
          <DialogHeader>
            <DialogTitle>More</DialogTitle>
            <DialogDescription>Tools for your farm.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 py-3 sm:gap-4">
            {tools.map(({ value, label, icon: Icon }) => <button key={value} type="button" aria-current={activeTab === value ? 'page' : undefined}
              className={cn('flex min-h-32 flex-col items-center justify-center gap-3 rounded-xl p-4 text-sm font-semibold transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', activeTab === value && 'bg-muted')}
              onClick={() => { onSelect(value); setOpen(false); }}>
              <span className="flex h-16 w-16 items-center justify-center rounded-xl bg-muted"><Icon className="h-8 w-8" strokeWidth={1.7} aria-hidden="true" /></span>
              {label}
            </button>)}
          </div>
        </DialogContent>
      </Dialog>
    </div>
    {selectedTool && <p className="px-2 text-sm text-muted-foreground">More <span aria-hidden="true" className="px-1">/</span> <span className="font-medium text-foreground">{selectedTool.label}</span></p>}
  </div>;
}
