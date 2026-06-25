'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { cn } from '@/lib/utils';

type ScriptCard = {
  id: string;
  name: string;
  body: string;
  createdAt: string | null;
  updatedAt: string | null;
};

type ScriptsResponse = {
  scripts?: ScriptCard[];
  storageReady?: boolean;
  error?: string;
};

const TEAM_SCRIPT_NAME = 'Real Estate Teams - quick demo';
const TEAM_SCRIPT_ID = 'real-estate-teams-quick-demo';
const SOLO_SCRIPT_NAME = 'Individual Realtors - listing leverage trial';
const SOLO_SCRIPT_ID = 'individual-realtors-listing-leverage-trial';
const SOLO_V2_SCRIPT_NAME = 'Individual Realtors - listing leverage trial V2';
const SOLO_V2_SCRIPT_ID = 'individual-realtors-listing-leverage-trial-v2';
const SCRIPT_LABEL_ORDER = ['TEAM SCRIPT', 'SOLO AGENT SCRIPT', 'SOLO AGENT SCRIPT V2'] as const;

function scriptDisplayName(script: ScriptCard): string | null {
  if (script.id === TEAM_SCRIPT_ID || script.name === TEAM_SCRIPT_NAME) return 'TEAM SCRIPT';
  if (script.id === SOLO_SCRIPT_ID || script.name === SOLO_SCRIPT_NAME) return 'SOLO AGENT SCRIPT';
  if (script.id === SOLO_V2_SCRIPT_ID || script.name === SOLO_V2_SCRIPT_NAME) return 'SOLO AGENT SCRIPT V2';
  return null;
}

function scriptDisplayOrder(label: string): number {
  const index = SCRIPT_LABEL_ORDER.findIndex((item) => item === label);
  return index === -1 ? SCRIPT_LABEL_ORDER.length : index;
}

export function ScriptsPage() {
  const { currentWorkspaceId, isLoading: workspaceLoading } = useWorkspace();
  const [scripts, setScripts] = useState<ScriptCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const endpoint = useMemo(() => {
    const params = new URLSearchParams();
    if (currentWorkspaceId) params.set('workspaceId', currentWorkspaceId);
    const query = params.toString();
    return `/api/scripts${query ? `?${query}` : ''}`;
  }, [currentWorkspaceId]);

  const loadScripts = useCallback(async () => {
    if (workspaceLoading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(endpoint, { credentials: 'include' });
      const data = (await response.json().catch(() => ({}))) as ScriptsResponse;
      if (!response.ok) {
        throw new Error(data.error ?? 'Scripts could not be loaded.');
      }
      setScripts(data.scripts ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Scripts could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [endpoint, workspaceLoading]);

  useEffect(() => {
    void loadScripts();
  }, [loadScripts]);

  const visibleScripts = useMemo(
    () =>
      scripts
        .map((script) => ({ script, label: scriptDisplayName(script) }))
        .filter((item): item is { script: ScriptCard; label: string } => Boolean(item.label))
        .sort((a, b) => {
          if (a.label === b.label) return 0;
          return scriptDisplayOrder(a.label) - scriptDisplayOrder(b.label);
        }),
    [scripts]
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">
      <header className="border-b border-border bg-white dark:bg-card">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <h1 className="text-2xl font-bold dark:text-white">Scripts</h1>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        {error && (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex min-h-[12rem] items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            Loading
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {visibleScripts.map(({ script, label }) => (
              <Link
                key={script.id}
                href={`/scripts/${script.id}${currentWorkspaceId ? `?workspaceId=${currentWorkspaceId}` : ''}`}
                className={cn(
                  'group flex min-h-40 items-center justify-between rounded-lg border border-border bg-card p-8 text-card-foreground shadow-sm transition-colors',
                  'hover:border-primary/50 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                )}
              >
                <span className="text-3xl font-black tracking-normal sm:text-4xl">
                  {label}
                </span>
                <ArrowRight className="size-7 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
