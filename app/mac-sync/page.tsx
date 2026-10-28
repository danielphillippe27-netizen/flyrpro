'use client';
import { useEffect } from 'react';
import { createMacSyncRuntime } from '@/lib/mac-companion/runtime';
import { hasMacBridge } from '@/lib/mac-companion/client';
export default function MacSyncRuntimePage() {
  useEffect(() => {
    if (!hasMacBridge()) return;
    const params = new URLSearchParams(window.location.search);
    const user = params.get('userId'), workspace = params.get('workspaceId');
    if (!user || !workspace) return;
    const runtime = createMacSyncRuntime(workspace, user);
    const target = window as unknown as { wolfgridSyncTick?: () => Promise<void>; wolfgridSyncNow?: () => Promise<void> };
    target.wolfgridSyncTick = () => runtime.tick(); target.wolfgridSyncNow = () => runtime.tick(true);
    void runtime.tick();
    return () => { runtime.stop(); delete target.wolfgridSyncTick; delete target.wolfgridSyncNow; };
  }, []);
  return <p className="p-4 text-sm text-muted-foreground">WolfGrid Mac synchronization is managed by the app.</p>;
}
