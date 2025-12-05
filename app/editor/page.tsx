'use client';

import { QueryProvider } from '@/lib/editor-canva/components/query-provider';
import { Editor } from '@/lib/editor-canva/features/editor/components/editor';

// Temporary mock data - will be replaced with actual project data
// Default to 8.5" × 5.5" @ 300 DPI = 2550 × 1650 px (trim size)
const mockProjectData = {
  id: 'temp-project',
  name: 'New Design',
  userId: 'temp-user',
  json: JSON.stringify({
    version: '5.3.0',
    objects: [],
    width: 2550,
    height: 1650,
  }),
  height: 1650,
  width: 2550,
  thumbnailUrl: null,
  isTemplate: false,
  isPro: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

export default function EditorPage() {
  return (
    <QueryProvider>
      <div className="h-screen w-full">
        <Editor initialData={mockProjectData as any} />
      </div>
    </QueryProvider>
  );
}



