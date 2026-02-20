'use client';

import { cn } from '@/lib/utils';
import { useWorkspace } from '@/lib/workspace-context';

type WorkspaceSwitcherProps = {
  expanded: boolean;
};

export default function WorkspaceSwitcher({ expanded }: WorkspaceSwitcherProps) {
  const {
    workspaces,
    membershipsByWorkspaceId,
    currentWorkspace,
    currentWorkspaceId,
    isLoading,
    error,
    setCurrentWorkspaceId,
  } = useWorkspace();

  if (!expanded) {
    return (
      <div className="w-full px-1.5 pb-1">
        <div
          className={cn(
            'mx-auto flex h-7 w-7 items-center justify-center rounded-md border border-border/60 text-[11px] font-semibold text-muted-foreground'
          )}
          title={currentWorkspace?.name ?? 'Workspace'}
          aria-label={currentWorkspace?.name ?? 'Workspace'}
        >
          {(currentWorkspace?.name?.[0] ?? 'W').toUpperCase()}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full px-1.5 pb-1">
      <label className="mb-1 block px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Workspace
      </label>

      <select
        className="h-8 w-full rounded-md border border-border bg-background px-2 text-[12px] text-foreground outline-none ring-offset-background focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
        value={currentWorkspaceId ?? ''}
        disabled={isLoading || workspaces.length === 0}
        onChange={(event) => {
          if (event.target.value) {
            setCurrentWorkspaceId(event.target.value);
          }
        }}
        aria-label="Select workspace"
      >
        {isLoading && <option value="">Loading workspaces...</option>}
        {!isLoading && workspaces.length === 0 && <option value="">No workspaces</option>}
        {!isLoading &&
          workspaces.map((workspace) => {
            const role = membershipsByWorkspaceId[workspace.id];
            const label = role ? `${workspace.name} (${role})` : workspace.name;
            return (
              <option key={workspace.id} value={workspace.id}>
                {label}
              </option>
            );
          })}
      </select>

      {error && (
        <p className="mt-1 px-1 text-[10px] leading-tight text-red-500">
          Failed to load workspaces.
        </p>
      )}
    </div>
  );
}
