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
function workspaceStorageKeyForUser(userId: string): string {
  return `${CURRENT_WORKSPACE_STORAGE_KEY}:${userId}`;
}

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
  created_at?: string;
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
  created_at?: string;
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

type AccessStateRow = {
  userId?: string | null;
  workspaceId?: string | null;
  workspace_id?: string | null;
  workspaceName?: string | null;
  role?: WorkspaceRole | null;
  memberCount?: number | null;
};

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [memberships, setMemberships] = useState<WorkspaceMembership[]>([]);
  const [memberCountByWorkspaceId, setMemberCountByWorkspaceId] = useState<Record<string, number>>({});
  const [currentWorkspaceId, setCurrentWorkspaceIdState] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setCurrentWorkspaceId = useCallback((workspaceId: string) => {
    setCurrentWorkspaceIdState(workspaceId);
    if (typeof window !== 'undefined' && currentUserId) {
      window.localStorage.setItem(workspaceStorageKeyForUser(currentUserId), workspaceId);
    }
  }, [currentUserId]);

  const refreshWorkspaces = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const hydrateFromAccessState = async (): Promise<boolean> => {
        const response = await fetch('/api/access/state', { credentials: 'include' });
        if (!response.ok) return false;
        const data = (await response.json()) as AccessStateRow;
        const workspaceId =
          (typeof data.workspaceId === 'string' && data.workspaceId) ||
          (typeof data.workspace_id === 'string' && data.workspace_id) ||
          null;
        if (!workspaceId) return false;

        const workspaceName =
          typeof data.workspaceName === 'string' && data.workspaceName.trim()
            ? data.workspaceName.trim()
            : 'Workspace';
        const role: WorkspaceRole =
          data.role === 'owner' || data.role === 'admin' || data.role === 'member'
            ? data.role
            : 'member';
        const userId = typeof data.userId === 'string' && data.userId ? data.userId : null;

        setCurrentUserId(userId);
        setWorkspaces([
          {
            id: workspaceId,
            name: workspaceName,
            owner_id: null,
            created_at: new Date(0).toISOString(),
            updated_at: new Date().toISOString(),
            brokerage_id: null,
            brokerage_name: null,
          },
        ]);
        setMemberships([{ workspace_id: workspaceId, role }]);
        setMemberCountByWorkspaceId({
          [workspaceId]: typeof data.memberCount === 'number' ? data.memberCount : 0,
        });
        setCurrentWorkspaceIdState(workspaceId);

        if (typeof window !== 'undefined' && userId) {
          window.localStorage.setItem(workspaceStorageKeyForUser(userId), workspaceId);
          window.localStorage.removeItem(CURRENT_WORKSPACE_STORAGE_KEY);
        }

        return true;
      };

      const supabase = await getClientAsync();

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;
      if (!user) {
        const hydrated = await hydrateFromAccessState();
        if (hydrated) {
          setIsLoading(false);
          return;
        }
        setWorkspaces([]);
        setMemberships([]);
        setMemberCountByWorkspaceId({});
        setCurrentUserId(null);
        setCurrentWorkspaceIdState(null);
        setIsLoading(false);
        return;
      }
      setCurrentUserId(user.id);

      const { data: membershipRows, error: membershipError } = await supabase
        .from('workspace_members')
        .select('workspace_id, role, created_at')
        .eq('user_id', user.id);

      if (membershipError) throw membershipError;

      const safeMembershipRows = (membershipRows ?? []) as MembershipRow[];
      const workspaceIds = Array.from(
        new Set(safeMembershipRows.map((row) => row.workspace_id).filter(Boolean))
      );
      if (workspaceIds.length === 0) {
        const hydrated = await hydrateFromAccessState();
        if (hydrated) {
          setIsLoading(false);
          return;
        }
      }

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
          created_at: row.created_at,
        }))
      );

      const roleRank = (role: WorkspaceRole) =>
        role === 'owner' ? 0 : role === 'admin' ? 1 : 2;

      const membershipByWorkspaceId = new Map(
        safeMembershipRows.map((row) => [row.workspace_id, row])
      );
      const sortedWorkspaceRows = [...safeWorkspaceRows].sort((a, b) => {
        const aMembership = membershipByWorkspaceId.get(a.id);
        const bMembership = membershipByWorkspaceId.get(b.id);
        const aRole = aMembership?.role ?? 'member';
        const bRole = bMembership?.role ?? 'member';
        const byRole = roleRank(aRole) - roleRank(bRole);
        if (byRole !== 0) return byRole;

        const aCreated = aMembership?.created_at ? new Date(aMembership.created_at).getTime() : Number.MAX_SAFE_INTEGER;
        const bCreated = bMembership?.created_at ? new Date(bMembership.created_at).getTime() : Number.MAX_SAFE_INTEGER;
        if (aCreated !== bCreated) return aCreated - bCreated;

        return a.created_at.localeCompare(b.created_at);
      });

      setWorkspaces(sortedWorkspaceRows);

      const validIds = new Set(sortedWorkspaceRows.map((ws) => ws.id));
      const namespacedKey = workspaceStorageKeyForUser(user.id);
      const storedWorkspaceId =
        typeof window !== 'undefined'
          ? window.localStorage.getItem(namespacedKey) ||
            window.localStorage.getItem(CURRENT_WORKSPACE_STORAGE_KEY)
          : null;
      const nextWorkspaceId = storedWorkspaceId && validIds.has(storedWorkspaceId)
        ? storedWorkspaceId
        : sortedWorkspaceRows[0]?.id ?? null;

      setCurrentWorkspaceIdState(nextWorkspaceId);
      if (typeof window !== 'undefined') {
        if (nextWorkspaceId) {
          window.localStorage.setItem(namespacedKey, nextWorkspaceId);
          window.localStorage.removeItem(CURRENT_WORKSPACE_STORAGE_KEY);
        } else {
          window.localStorage.removeItem(namespacedKey);
        }
      }
    } catch (err) {
      try {
        const response = await fetch('/api/access/state', { credentials: 'include' });
        if (response.ok) {
          const data = (await response.json()) as AccessStateRow;
          const workspaceId =
            (typeof data.workspaceId === 'string' && data.workspaceId) ||
            (typeof data.workspace_id === 'string' && data.workspace_id) ||
            null;
          if (workspaceId) {
            const role: WorkspaceRole =
              data.role === 'owner' || data.role === 'admin' || data.role === 'member'
                ? data.role
                : 'member';
            const userId = typeof data.userId === 'string' && data.userId ? data.userId : null;
            setCurrentUserId(userId);
            setWorkspaces([
              {
                id: workspaceId,
                name:
                  typeof data.workspaceName === 'string' && data.workspaceName.trim()
                    ? data.workspaceName.trim()
                    : 'Workspace',
                owner_id: null,
                created_at: new Date(0).toISOString(),
                updated_at: new Date().toISOString(),
                brokerage_id: null,
                brokerage_name: null,
              },
            ]);
            setMemberships([{ workspace_id: workspaceId, role }]);
            setMemberCountByWorkspaceId({
              [workspaceId]: typeof data.memberCount === 'number' ? data.memberCount : 0,
            });
            setCurrentWorkspaceIdState(workspaceId);
            setError(null);
            return;
          }
        }
      } catch {
        // Fall through to standard error state.
      }

      const message = err instanceof Error ? err.message : 'Failed to load workspaces';
      setError(message);
      setWorkspaces([]);
      setMemberships([]);
      setMemberCountByWorkspaceId({});
      setCurrentUserId(null);
      setCurrentWorkspaceIdState(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshWorkspaces();
  }, [refreshWorkspaces]);

  useEffect(() => {
    let isCancelled = false;
    let unsubscribe: (() => void) | undefined;

    getClientAsync()
      .then((supabase) => {
        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange(() => {
          if (!isCancelled) void refreshWorkspaces();
        });
        unsubscribe = () => subscription.unsubscribe();
      })
      .catch(() => {});

    return () => {
      isCancelled = true;
      if (unsubscribe) unsubscribe();
    };
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
