'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Flyer Editor Page
 * 
 * Redirects to the main editor-canva editor at /editor
 */
export default function FlyerEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const router = useRouter();

  useEffect(() => {
    router.replace('/editor');
  }, [router]);

  return null;
}



