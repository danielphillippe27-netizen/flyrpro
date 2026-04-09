'use client';

import { RoutesShellLayout } from '@/components/routes/RoutesShellLayout';

export default function RoutesLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoutesShellLayout
      basePath="/routes"
      localStorageCollapsedKey="flyr-routes-sidebar-collapsed"
      indexTitle="Routes"
    >
      {children}
    </RoutesShellLayout>
  );
}
