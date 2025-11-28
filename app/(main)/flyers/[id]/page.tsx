'use client';

import { use, useState, useEffect } from 'react';
import { getTemplateById } from '@/lib/flyerTemplates';
import { EditorShell } from '@/components/editor/EditorShell';
import { useEditorStore } from '@/lib/editor/state';
import { convertFlyerTemplateToEditorState } from '@/lib/editor/templateConverter';
import { applySnapshot } from '@/lib/editor/history';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { ErrorState } from '@/components/ErrorState';

/**
 * Flyer Editor Page
 * 
 * Main editor interface for creating and editing flyers.
 * Uses the new Mini Canva-style editor with full features.
 */
export default function FlyerEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const templateId = resolvedParams.id;
  const { reset } = useEditorStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load template and convert to new format
  useEffect(() => {
    try {
      // Get old template format
      const flyerTemplate = getTemplateById(templateId);
      if (!flyerTemplate) {
        setError(`Template "${templateId}" not found`);
        setLoading(false);
        return;
      }

      // Convert to new editor format
      const editorState = convertFlyerTemplateToEditorState(flyerTemplate);
      
      // Reset store and apply the template
      reset();
      const state = useEditorStore.getState();
      const newState = applySnapshot(state, editorState);
      useEditorStore.setState(newState);
      
      setLoading(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load template'
      );
      setLoading(false);
    }
  }, [templateId, reset]);

  if (loading) {
    return (
      <div className="h-screen bg-gray-50 flex items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen bg-gray-50">
        <ErrorState
          message={error}
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }

  return <EditorShell />;
}

