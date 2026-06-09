const DIALER_ENABLED_WORKSPACE_IDS_ENV = 'DIALER_ENABLED_WORKSPACE_IDS';
const DIALER_FOUNDER_BYPASS_EMAILS_ENV = 'DIALER_FOUNDER_BYPASS_EMAILS';
const DEFAULT_FOUNDER_BYPASS_EMAILS = ['danielfounder@gmail.com'];

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

export function getDialerFounderBypassEmails(): string[] {
  const configured = parseWorkspaceIdList(process.env[DIALER_FOUNDER_BYPASS_EMAILS_ENV]);
  return configured.length > 0 ? configured : DEFAULT_FOUNDER_BYPASS_EMAILS;
}

export function isDialerFounderBypassEmail(email: string | null | undefined): boolean {
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) return false;
  return getDialerFounderBypassEmails().some((allowedEmail) => allowedEmail.toLowerCase() === normalizedEmail);
}

export function isDialerWorkspaceAllowlistEnabled(): boolean {
  return getDialerEnabledWorkspaceIds().length > 0;
}

export function isDialerEnabledForWorkspace(
  workspaceId: string | null | undefined,
  userEmail?: string | null
): boolean {
  if (isDialerFounderBypassEmail(userEmail)) {
    return true;
  }

  const allowedWorkspaceIds = getDialerEnabledWorkspaceIds();
  if (allowedWorkspaceIds.length === 0) {
    return true;
  }

  return workspaceId != null && workspaceId.length > 0 && allowedWorkspaceIds.includes(workspaceId);
}

export function canDialerWorkspaceUseSharedDefault(
  workspaceId: string | null | undefined,
  userEmail?: string | null
): boolean {
  return isDialerFounderBypassEmail(userEmail) || (isDialerWorkspaceAllowlistEnabled() && isDialerEnabledForWorkspace(workspaceId));
}

export function getDialerWorkspaceAccessError(): string {
  return 'Power Dialer is not enabled for this workspace yet.';
}
