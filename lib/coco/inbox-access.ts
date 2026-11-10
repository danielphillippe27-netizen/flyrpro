const inboxAccounts = new Set([
  "daniel.phillippe27@gmail.com",
  "daniel@wolfgrid.app",
]);

export function canUseInbox(email: string | null | undefined): boolean {
  return inboxAccounts.has(email?.trim().toLowerCase() ?? "");
}
