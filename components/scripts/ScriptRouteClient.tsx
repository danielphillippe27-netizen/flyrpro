'use client';

import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import { ScriptReaderPage } from '@/components/scripts/ScriptReaderPage';

const SOLO_V2_SCRIPT_ID = 'individual-realtors-listing-leverage-trial-v2';

const ScriptFlowchartPage = dynamic(
  () => import('@/components/scripts/ScriptFlowchartPage').then((module) => module.ScriptFlowchartPage),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-[24rem] items-center justify-center bg-neutral-950 text-neutral-300">
        <Loader2 className="mr-2 size-4 animate-spin" />
        Loading flowchart
      </div>
    ),
  }
);

export function ScriptRouteClient({ scriptId }: { scriptId: string }) {
  if (scriptId === SOLO_V2_SCRIPT_ID) {
    return <ScriptFlowchartPage scriptId={scriptId} />;
  }

  return <ScriptReaderPage scriptId={scriptId} />;
}
