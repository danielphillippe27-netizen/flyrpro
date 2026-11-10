'use client';

import { SessionSales } from '@/components/field-sales/SessionSales';
import dynamic from 'next/dynamic';
import { Route } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SessionFarmLink } from './SessionFarmLink';

export const ActivityRouteMap = dynamic(
  () => import('@/components/home/team/SessionBreadcrumbMap').then((module) => module.SessionBreadcrumbMap),
  { ssr: false, loading: () => <div className="grid h-full place-items-center rounded-xl bg-muted text-sm text-muted-foreground">Loading route map…</div> }
);

type SessionRoute = {
  id: string;
  path: GeoJSON.LineString | null;
  title: string;
  time: string;
  campaignId: string | null;
  metrics: { label: string; value: string }[];
};

export function SessionRouteDialog({
  session,
  onClose,
  returnFocus,
}: {
  session: SessionRoute | null;
  onClose: () => void;
  returnFocus: () => void;
}) {
  return (
    <Dialog open={session !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-[90rem] gap-3 overflow-y-auto rounded-2xl border-border bg-card p-3 shadow-2xl hover:shadow-2xl! sm:w-[calc(100%-3rem)] sm:max-w-[90rem] sm:gap-4 sm:p-5"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus();
        }}
      >
        {session && (
          <>
            <DialogHeader className="gap-1.5 px-1 py-1 pr-9 text-left">
              <DialogTitle className="flex items-center gap-2 text-xl">
                <Route className="size-5 text-primary" aria-hidden="true" />
                Session Activity
              </DialogTitle>
              <DialogDescription>{session.title} · {session.time}</DialogDescription>
            </DialogHeader>
            <SessionSales sessionId={session.id} />
            {session.path ? <div className="h-[clamp(25rem,72dvh,54rem)] sm:h-[clamp(26rem,73dvh,54rem)]">
              <ActivityRouteMap
                pathGeojson={session.path}
                className="h-full"
                color="#4c8dff"
                overlay={
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl border border-white/15 bg-zinc-950/90 px-3 py-2.5 text-white shadow-xl backdrop-blur-md min-[360px]:grid-cols-3 min-[500px]:grid-cols-4 sm:gap-3 sm:p-4 xl:grid-flow-col xl:auto-cols-fr xl:grid-cols-none">
                    {session.metrics.map(({ label, value }) => (
                      <div key={label} className="min-w-0">
                        <dt className="text-[11px] leading-tight text-zinc-300 sm:text-xs">{label}</dt>
                        <dd className="mt-0.5 text-sm font-semibold tabular-nums sm:text-lg">{value}</dd>
                      </div>
                    ))}
                  </dl>
                }
              />
            </div>
            : <dl className="grid grid-cols-2 gap-3 p-2 sm:grid-cols-4">
                {session.metrics.map(({ label, value }) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="text-sm font-semibold">{value}</dd></div>)}
              </dl>}
            <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 px-1 text-xs text-muted-foreground">
              {session.path ? <div className="flex items-center gap-4">
                <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-green-500" /> Start</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-red-500" /> Finish</span>
              </div> : <span>No GPS route recorded</span>}
              <SessionFarmLink campaignId={session.campaignId} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
