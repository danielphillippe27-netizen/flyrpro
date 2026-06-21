import type { ReactNode } from 'react';
import { requireFlyrDemoAdminAccess } from '@/lib/auth/flyrInternalWorkspace';

export default async function DemoAdminLayout({ children }: { children: ReactNode }) {
  await requireFlyrDemoAdminAccess();

  return children;
}
