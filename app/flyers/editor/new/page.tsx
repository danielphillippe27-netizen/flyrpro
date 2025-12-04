'use client';

import { useEffect } from 'react';
import { EditorShell } from '@/components/editor/EditorShell';
import { useEditorStore } from '@/lib/editor/state';

/**
 * New Flyer Editor Page
 * 
 * Full-screen editor for creating new flyers from scratch.
 * This route is outside the (main) layout group, so no navigation sidebar is shown.
 */
export default function NewFlyerEditorPage() {
  const { reset } = useEditorStore();

  // Initialize with blank canvas on mount
  useEffect(() => {
    reset();
  }, [reset]);

  return <EditorShell />;
}

