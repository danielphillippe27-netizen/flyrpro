import type { ReactNode } from 'react';
import { requireFlyrInternalWorkspaceMember } from '@/lib/auth/flyrInternalWorkspace';

export default async function DemoAdminLayout({ children }: { children: ReactNode }) {
  await requireFlyrInternalWorkspaceMember();

  return children;
}
