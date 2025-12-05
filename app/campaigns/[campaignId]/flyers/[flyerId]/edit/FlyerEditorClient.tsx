'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface FlyerEditorClientProps {
  campaignId: string;
  flyerId: string;
  initialData: unknown;
}

/**
 * FlyerEditorClient - Redirects to the new editor
 * The old editor has been removed in favor of the new unified editor at /editor
 */
export function FlyerEditorClient({ campaignId, flyerId }: FlyerEditorClientProps) {
  const router = useRouter();

  useEffect(() => {
    // Redirect to the new editor
    router.replace('/editor');
  }, [router]);

  return (
    <div className="h-screen flex items-center justify-center">
      <div className="text-center">
        <p className="text-slate-400">Redirecting to new editor...</p>
      </div>
    </div>
  );
}



