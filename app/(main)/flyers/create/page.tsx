'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Redirect old flyer create page to new editor
 * This maintains backward compatibility for any existing links
 */
export default function FlyerCreatePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/flyers/editor/new');
  }, [router]);

  return null;
}



