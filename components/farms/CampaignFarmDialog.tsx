'use client';

import dynamic from 'next/dynamic';
import { Sprout } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

const FarmCreationWorkspace = dynamic(() => import('./FarmCreationWorkspace').then(module => module.FarmCreationWorkspace), {
  ssr: false,
  loading: () => <p role="status" className="p-5">Loading farm map…</p>,
});

export function CampaignFarmDialog({ open, onOpenChange, initialBoundary, initialName }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialBoundary?: GeoJSON.Polygon | null;
  initialName?: string;
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
      <DialogHeader className="shrink-0 border-b px-5 py-3 pr-12 text-left">
        <DialogTitle className="flex items-center gap-2"><Sprout className="h-4 w-4 text-emerald-400" aria-hidden="true" />Farm</DialogTitle>
        <DialogDescription>Create a farm to revisit the same area. It will appear in your Campaign list.</DialogDescription>
      </DialogHeader>
      {open && <div className="min-h-0 flex-1"><FarmCreationWorkspace initialBoundary={initialBoundary} initialName={initialName} onCreated={() => onOpenChange(false)} /></div>}
    </DialogContent>
  </Dialog>;
}
