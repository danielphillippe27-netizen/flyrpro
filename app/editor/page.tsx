'use client';

import { useEffect, useState } from 'react';
import { QueryProvider } from '@/lib/editor-canva/components/query-provider';
import { Editor } from '@/lib/editor-canva/features/editor/components/editor';
import type { ResponseType } from '@/lib/editor-canva/features/projects/api/use-get-project';

type EditorProject = ResponseType['data'];

const DEFAULT_WIDTH = 2550;
const DEFAULT_HEIGHT = 1650;

export default function EditorPage() {
  const [project, setProject] = useState<EditorProject | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadProject() {
      try {
        const listResponse = await fetch('/api/editor/projects', { cache: 'no-store' });
        if (!listResponse.ok) throw new Error('Failed to load projects');
        const listPayload = await listResponse.json();
        let selected = (listPayload?.data?.[0] ?? null) as EditorProject | null;

        if (!selected) {
          const createResponse = await fetch('/api/editor/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: 'New Design',
              width: DEFAULT_WIDTH,
              height: DEFAULT_HEIGHT,
              json: JSON.stringify({
                version: '5.3.0',
                objects: [],
                width: DEFAULT_WIDTH,
                height: DEFAULT_HEIGHT,
              }),
            }),
          });
          if (!createResponse.ok) throw new Error('Failed to create project');
          const createPayload = await createResponse.json();
          selected = createPayload?.data ?? null;
        }

        if (!cancelled) setProject(selected);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load editor');
        }
      }
    }

    void loadProject();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <QueryProvider>
      <div className="h-screen w-full">
        {error ? (
          <div className="flex h-full items-center justify-center p-6 text-sm text-red-600">{error}</div>
        ) : project ? (
          <Editor initialData={project} />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
            Loading editor...
          </div>
        )}
      </div>
    </QueryProvider>
  );
}
