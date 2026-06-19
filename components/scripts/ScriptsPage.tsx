'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, FileText, Loader2, Plus } from 'lucide-react';
import { useWorkspace } from '@/lib/workspace-context';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

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

export function ScriptsPage() {
  const { currentWorkspaceId, isLoading: workspaceLoading } = useWorkspace();
  const [scripts, setScripts] = useState<ScriptCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(true);

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
      setStorageReady(data.storageReady !== false);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Scripts could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [endpoint, workspaceLoading]);

  useEffect(() => {
    void loadScripts();
  }, [loadScripts]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedBody = body.trim();
    if (!trimmedName || !trimmedBody) {
      setError('Add a name and body before saving.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/scripts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          workspaceId: currentWorkspaceId,
          name: trimmedName,
          body: trimmedBody,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as ScriptsResponse & {
        script?: ScriptCard;
      };
      if (!response.ok || !data.script) {
        throw new Error(data.error ?? 'Script could not be saved.');
      }

      setScripts((current) => [data.script!, ...current]);
      setName('');
      setBody('');
      setDialogOpen(false);
      setStorageReady(data.storageReady !== false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Script could not be saved.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">
      <header className="border-b border-border bg-white dark:bg-card">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <h1 className="text-2xl font-bold dark:text-white">Scripts</h1>
          <Button
            size="icon"
            onClick={() => setDialogOpen(true)}
            aria-label="Add script"
            title="Add script"
          >
            <Plus className="size-4" />
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        {error && (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive">
            {error}
          </div>
        )}

        {!storageReady && (
          <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm font-medium text-amber-700 dark:text-amber-300">
            Supabase script storage is not ready. Run the workspace scripts migration to save new scripts.
          </div>
        )}

        {loading ? (
          <div className="flex min-h-[12rem] items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" />
            Loading
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {scripts.map((script) => (
              <Link
                key={script.id}
                href={`/scripts/${script.id}${currentWorkspaceId ? `?workspaceId=${currentWorkspaceId}` : ''}`}
                className={cn(
                  'group flex min-h-28 flex-col justify-between rounded-lg border border-border bg-card p-4 text-card-foreground shadow-sm transition-colors',
                  'hover:border-primary/50 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText className="size-4 shrink-0 text-primary" />
                    <span className="truncate text-sm font-semibold">{script.name}</span>
                  </div>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
                </div>
                <p className="line-clamp-2 pt-4 text-xs leading-5 text-muted-foreground">
                  {script.body}
                </p>
              </Link>
            ))}
          </div>
        )}
      </main>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New script</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="script-name">Name</Label>
              <Input
                id="script-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={120}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="script-body">Body</Label>
              <Textarea
                id="script-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                className="min-h-48 resize-y"
                maxLength={12000}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
