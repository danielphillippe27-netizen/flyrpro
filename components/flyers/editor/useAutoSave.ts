import { useEffect, useRef } from 'react';
import { useFlyerEditorStore } from './useFlyerEditorStore';
import { FlyerEditorService } from '@/lib/services/FlyerEditorService';

interface UseAutoSaveOptions {
  flyerId: string;
  enabled?: boolean;
  debounceMs?: number;
}

/**
 * Auto-save hook that debounces flyer data updates and saves to Supabase
 */
export function useAutoSave({ flyerId, enabled = true, debounceMs = 1500 }: UseAutoSaveOptions) {
  const flyerData = useFlyerEditorStore((state) => state.flyerData);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef<string>('');

  useEffect(() => {
    if (!enabled) return;

    // Serialize current data for comparison
    const currentDataString = JSON.stringify(flyerData);

    // Skip if data hasn't changed
    if (currentDataString === lastSavedRef.current) {
      return;
    }

    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Set new timeout
    timeoutRef.current = setTimeout(async () => {
      try {
        await FlyerEditorService.updateFlyerData(flyerId, flyerData);
        lastSavedRef.current = currentDataString;
      } catch (error) {
        console.error('Failed to auto-save flyer:', error);
        // Could show a toast notification here
      }
    }, debounceMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [flyerData, flyerId, enabled, debounceMs]);

  // Save immediately on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      // Final save on unmount
      if (enabled && lastSavedRef.current !== JSON.stringify(flyerData)) {
        FlyerEditorService.updateFlyerData(flyerId, flyerData).catch(console.error);
      }
    };
  }, []);
}

