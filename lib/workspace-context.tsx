'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { getClientAsync } from '@/lib/supabase/client';

const CURRENT_WORKSPACE_STORAGE_KEY = 'flyr.currentWorkspaceId';

export type WorkspaceRole = 'owner' | 'admin' | 'member';

export type Workspace = {
  id: string;
  name: string;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
  /** Canonical brokerage (when set during onboarding). */
  brokerage_id: string | null;
  /** Free-text brokerage name when no template match. */
  brokerage_name: string | null;
};

type WorkspaceMembership = {
  workspace_id: string;
  role: WorkspaceRole;
};

type WorkspaceContextValue = {
  workspaces: Workspace[];
  membershipsByWorkspaceId: Record<string, WorkspaceRole>;
  /** Number of members per workspace (for team vs solo gating). */
  memberCountByWorkspaceId: Record<string, number>;
  currentWorkspace: Workspace | null;
  currentWorkspaceId: string | null;
  isLoading: boolean;
  error: string | null;
  setCurrentWorkspaceId: (workspaceId: string) => void;
  refreshWorkspaces: () => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

type MembershipRow = {
  workspace_id: string;
  role: WorkspaceRole;
};

type WorkspaceRow = {
  id: string;
  name: string;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
  brokerage_id: string | null;
  brokerage_name: string | null;
};

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [memberships, setMemberships] = useState<WorkspaceMembership[]>([]);
  const [memberCountByWorkspaceId, setMemberCountByWorkspaceId] = useState<Record<string, number>>({});
  const [currentWorkspaceId, setCurrentWorkspaceIdState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setCurrentWorkspaceId = useCallback((workspaceId: string) => {
    setCurrentWorkspaceIdState(workspaceId);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(CURRENT_WORKSPACE_STORAGE_KEY, workspaceId);
    }
  }, []);

  const refreshWorkspaces = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const supabase = await getClientAsync();

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;
      if (!user) {
        setWorkspaces([]);
        setMemberships([]);
        setCurrentWorkspaceIdState(null);
        setIsLoading(false);
        return;
      }

      const { data: membershipRows, error: membershipError } = await supabase
        .from('workspace_members')
        .select('workspace_id, role')
        .eq('user_id', user.id);

      if (membershipError) throw membershipError;

      const safeMembershipRows = (membershipRows ?? []) as MembershipRow[];
      const workspaceIds = Array.from(
        new Set(safeMembershipRows.map((row) => row.workspace_id).filter(Boolean))
      );

      let safeWorkspaceRows: WorkspaceRow[] = [];
      const countMap: Record<string, number> = {};
      if (workspaceIds.length > 0) {
        const [workspaceResult, membersResult] = await Promise.all([
          supabase
            .from('workspaces')
            .select('id, name, owner_id, created_at, updated_at, brokerage_id, brokerage_name')
            .in('id', workspaceIds)
            .order('created_at', { ascending: true }),
          supabase
            .from('workspace_members')
            .select('workspace_id')
            .in('workspace_id', workspaceIds),
        ]);

        if (workspaceResult.error) throw workspaceResult.error;
        safeWorkspaceRows = (workspaceResult.data ?? []) as WorkspaceRow[];

        const memberRows = (membersResult.data ?? []) as { workspace_id: string }[];
        for (const row of memberRows) {
          countMap[row.workspace_id] = (countMap[row.workspace_id] ?? 0) + 1;
        }
      }

      setMemberCountByWorkspaceId(countMap);
      setMemberships(
        safeMembershipRows.map((row) => ({
          workspace_id: row.workspace_id,
          role: row.role,
        }))
      );
      setWorkspaces(safeWorkspaceRows);

      const validIds = new Set(safeWorkspaceRows.map((ws) => ws.id));
      const storedWorkspaceId =
        typeof window !== 'undefined'
          ? window.localStorage.getItem(CURRENT_WORKSPACE_STORAGE_KEY)
          : null;
      const nextWorkspaceId = storedWorkspaceId && validIds.has(storedWorkspaceId)
        ? storedWorkspaceId
        : safeWorkspaceRows[0]?.id ?? null;

      setCurrentWorkspaceIdState(nextWorkspaceId);
      if (typeof window !== 'undefined') {
        if (nextWorkspaceId) {
          window.localStorage.setItem(CURRENT_WORKSPACE_STORAGE_KEY, nextWorkspaceId);
        } else {
          window.localStorage.removeItem(CURRENT_WORKSPACE_STORAGE_KEY);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load workspaces';
      setError(message);
      setWorkspaces([]);
      setMemberships([]);
      setMemberCountByWorkspaceId({});
      setCurrentWorkspaceIdState(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshWorkspaces();
  }, [refreshWorkspaces]);

  const currentWorkspace = useMemo(
    () => workspaces.find((ws) => ws.id === currentWorkspaceId) ?? null,
    [workspaces, currentWorkspaceId]
  );

  const membershipsByWorkspaceId = useMemo(() => {
    const map: Record<string, WorkspaceRole> = {};
    for (const membership of memberships) {
      map[membership.workspace_id] = membership.role;
    }
    return map;
  }, [memberships]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaces,
      membershipsByWorkspaceId,
      memberCountByWorkspaceId,
      currentWorkspace,
      currentWorkspaceId,
      isLoading,
      error,
      setCurrentWorkspaceId,
      refreshWorkspaces,
    }),
    [
      workspaces,
      membershipsByWorkspaceId,
      memberCountByWorkspaceId,
      currentWorkspace,
      currentWorkspaceId,
      isLoading,
      error,
      setCurrentWorkspaceId,
      refreshWorkspaces,
    ]
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useWorkspace must be used within WorkspaceProvider');
  }
  return ctx;
}
