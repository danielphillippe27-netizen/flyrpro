'use client';

import { useEffect, useState } from 'react';
import { useWorkspace } from '@/lib/workspace-context';
import type { DashboardAccessLevel } from '@/app/api/_utils/workspace';

export type ChallengesViewerContext = {
  userId: string;
  accessLevel: DashboardAccessLevel | null;
  isFounder: boolean;
  isTeamWorkspace: boolean;
  canCreateTeamChallenge: boolean;
  currentWorkspaceId: string | null;
};

export function useChallengesViewer(): ChallengesViewerContext {
  const { currentWorkspaceId, membershipsByWorkspaceId, memberCountByWorkspaceId } = useWorkspace();
  const [userId, setUserId] = useState('');
  const [accessLevel, setAccessLevel] = useState<DashboardAccessLevel | null>(null);
  const [isFounder, setIsFounder] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/access/state', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { userId?: string; accessLevel?: string; isFounder?: boolean } | null) => {
        if (cancelled || !data) return;
        if (typeof data.userId === 'string' && data.userId) setUserId(data.userId);
        if (typeof data.accessLevel === 'string') {
          setAccessLevel(data.accessLevel as DashboardAccessLevel);
        }
        setIsFounder(data.isFounder === true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const memberCount =
    currentWorkspaceId != null ? (memberCountByWorkspaceId[currentWorkspaceId] ?? 0) : 0;
  const isTeamWorkspace = memberCount > 1;
  const role = currentWorkspaceId ? membershipsByWorkspaceId[currentWorkspaceId] : undefined;
  const canCreateTeamChallenge = role === 'owner' && isTeamWorkspace;

  return {
    userId,
    accessLevel,
    isFounder,
    isTeamWorkspace,
    canCreateTeamChallenge,
    currentWorkspaceId,
  };
}
