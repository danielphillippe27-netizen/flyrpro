'use client';

import { RoutesShellLayout } from '@/components/routes/RoutesShellLayout';

export default function MembersLayout({ children }: { children: React.ReactNode }) {
  return (
    <RoutesShellLayout
      basePath="/members"
      localStorageCollapsedKey="flyr-members-routes-sidebar-collapsed"
      indexTitle="Members"
    >
      {children}
    </RoutesShellLayout>
  );
}
