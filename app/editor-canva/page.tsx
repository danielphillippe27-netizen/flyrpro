'use client';

import { QueryProvider } from '@/lib/editor-canva/components/query-provider';
import { Editor } from '@/lib/editor-canva/features/editor/components/editor';

// Temporary mock data - will be replaced with actual project data
const mockProjectData = {
  id: 'temp-project',
  name: 'New Design',
  userId: 'temp-user',
  json: JSON.stringify({
    version: '5.3.0',
    objects: [],
  }),
  height: 1080,
  width: 1920,
  thumbnailUrl: null,
  isTemplate: false,
  isPro: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

export default function EditorCanvaPage() {
  return (
    <QueryProvider>
      <div className="h-screen w-full">
        <Editor initialData={mockProjectData as any} />
      </div>
    </QueryProvider>
  );
}




