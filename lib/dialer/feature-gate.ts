const DIALER_ENABLED_WORKSPACE_IDS_ENV = 'DIALER_ENABLED_WORKSPACE_IDS';

function parseWorkspaceIdList(raw: string | undefined): string[] {
  if (!raw) return [];

  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function getDialerEnabledWorkspaceIds(): string[] {
  return parseWorkspaceIdList(process.env[DIALER_ENABLED_WORKSPACE_IDS_ENV]);
}

export function isDialerWorkspaceAllowlistEnabled(): boolean {
  return getDialerEnabledWorkspaceIds().length > 0;
}

export function isDialerEnabledForWorkspace(
  workspaceId: string | null | undefined
): boolean {
  const allowedWorkspaceIds = getDialerEnabledWorkspaceIds();
  if (allowedWorkspaceIds.length === 0) {
    return true;
  }

  return workspaceId != null && workspaceId.length > 0 && allowedWorkspaceIds.includes(workspaceId);
}

export function canDialerWorkspaceUseSharedDefault(
  workspaceId: string | null | undefined
): boolean {
  return isDialerWorkspaceAllowlistEnabled() && isDialerEnabledForWorkspace(workspaceId);
}

export function getDialerWorkspaceAccessError(): string {
  return 'Power Dialer is not enabled for this workspace yet.';
}
