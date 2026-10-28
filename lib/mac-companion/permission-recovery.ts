export type ApplePermissionSource = 'calendar' | 'reminders' | 'contacts' | 'messages';
/** Convert a native permission error into an allowlisted settings action. */
export function permissionRecovery(message: string) {
  if (!/permission|allow .*(?:access|settings)|access.{0,20}(?:denied|restricted)|system settings/i.test(message)) return null;
  const source: ApplePermissionSource | null = /calendar/i.test(message) ? 'calendar' : /reminder/i.test(message) ? 'reminders' : /contact/i.test(message) ? 'contacts' : /messages|full disk/i.test(message) ? 'messages' : null;
  if (!source) return null;
  const label = source === 'calendar' ? 'Open Calendar Settings' : source === 'reminders' ? 'Open Reminders Settings' : source === 'contacts' ? 'Open Contacts Settings' : 'Open Full Disk Access';
  return { source, label, message: message.replace(/^Messages unavailable:\s*/i, '') };
}
