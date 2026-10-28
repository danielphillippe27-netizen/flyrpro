'use client';
import { useWorkspace } from '@/lib/workspace-context';
import { StormMapWorkspace } from '@/components/storm-maps/StormMapWorkspace';

export default function StormsPage() {
  const { currentWorkspaceId } = useWorkspace();
  return <StormMapWorkspace workspaceId={currentWorkspaceId} />;
}
