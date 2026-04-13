'use client';

import { useEffect } from 'react';

export function PwaRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const cleanupLegacyServiceWorkers = async () => {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(
          registrations.map(async (registration) => {
            try {
              await registration.unregister();
            } catch {
              return;
            }
          })
        );

        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(
            keys
              .filter((key) => key.startsWith('flyr-') || key.includes('nav-fallback'))
              .map((key) => caches.delete(key))
          );
        }
      } catch {
        // Fail silently so app UX is unaffected if cleanup fails.
      }
    };

    cleanupLegacyServiceWorkers();
  }, []);

  return null;
}
