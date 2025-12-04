'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * New Flyer Editor Page
 * 
 * Redirects to the new Canva clone editor at /editor
 */
export default function NewFlyerEditorPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/editor');
  }, [router]);

  return null;
}

