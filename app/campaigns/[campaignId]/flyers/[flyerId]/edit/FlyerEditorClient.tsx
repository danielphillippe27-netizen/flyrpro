'use client';

import { useEffect } from 'react';
import { FlyerEditor } from '@/components/flyers/editor/FlyerEditor';
import { useFlyerEditorStore } from '@/components/flyers/editor/useFlyerEditorStore';
import { useAutoSave } from '@/components/flyers/editor/useAutoSave';
import type { FlyerData } from '@/lib/flyers/types';

interface FlyerEditorClientProps {
  campaignId: string;
  flyerId: string;
  initialData: FlyerData;
}

export function FlyerEditorClient({ campaignId, flyerId, initialData }: FlyerEditorClientProps) {
  const setFlyerData = useFlyerEditorStore((state) => state.setFlyerData);

  // Initialize store with fetched data
  useEffect(() => {
    setFlyerData(initialData);
  }, [initialData, setFlyerData]);

  // Enable auto-save
  useAutoSave({ flyerId, enabled: true });

  return <FlyerEditor campaignId={campaignId} flyerId={flyerId} />;
}



