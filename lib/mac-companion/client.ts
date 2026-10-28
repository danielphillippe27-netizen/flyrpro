export type NativePerson = { externalId: string; fullName: string; phones: string[]; emails: string[] };
export type MacPreferences = { sync_enabled: boolean; attachment_sync_enabled?:boolean; ai_messages_enabled: boolean; revision: number; poll_interval_seconds?: number; sync_consent_at?: string };
export type MacStatus = { userId: string; preferences: MacPreferences; devices: { device_id: string; status: string; last_seen_at: string; agent_version?: string | null }[] };
type NativeBridge = { postMessage: (input: Record<string, unknown>) => Promise<unknown> };
export function hasMacBridge() { return typeof window !== 'undefined' && !!(window as unknown as { webkit?: { messageHandlers?: { wolfgridMac?: NativeBridge } } }).webkit?.messageHandlers?.wolfgridMac; }
export async function macNative<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  const handler = (window as unknown as { webkit?: { messageHandlers?: { wolfgridMac?: NativeBridge } } }).webkit?.messageHandlers?.wolfgridMac;
  if (!handler) throw new Error('Open WolfGrid for Mac to use Apple integrations.');
  return await handler.postMessage({ action, ...data }) as T;
}
export class MacApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function macApi<T>(query: string, body?: unknown, signal?: AbortSignal, expectedOwner?: string): Promise<T> {
  const scoped = body && typeof body === 'object' ? body as Record<string, unknown> : undefined;
  const expectedUser = expectedOwner ?? (typeof scoped?.userId === 'string' ? scoped.userId : undefined);
  const payload = scoped ? Object.fromEntries(Object.entries(scoped).filter(([key]) => key !== 'userId')) : body;
  const response = await fetch(`/api/mac-companion${query}`, { credentials: 'include', cache: 'no-store', signal, ...(!body && expectedUser ? { headers: { 'x-wolfgrid-user-id': expectedUser } } : {}), ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json', ...(expectedUser ? { 'x-wolfgrid-user-id': expectedUser } : {}) }, body: JSON.stringify(payload) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new MacApiError(result.error || 'Mac connection unavailable.', response.status);
  return result;
}

export type AppleCapability = 'not_requested' | 'connected' | 'denied' | 'restricted' | 'write_only';
export type AppleNativeStatus = { deviceId: string; messagesAllowed: boolean; status?: string; agentVersion?: string; historyRanges?: boolean; contacts?: AppleCapability; calendar?: AppleCapability; reminders?: AppleCapability; phoneHandoff?: boolean; backgroundEnabled?: boolean; launchAtLogin?: boolean };
export type AppleOverview = { messages: number; conversations: number; approvedContacts: number; matchedContacts: number; importedContacts: number; lastSyncAt: string | null };
export type AppleContact = { id: string; full_name: string; phone: string | null; email: string | null; identifiers: { value: string; unique: boolean }[]; enabled: boolean | null; history_range: 'future' | '30d' | '90d' | 'all' | null; import_after: string | null; message_count: number };
export type AppleConversation = { id: string; full_name: string; phone: string | null; email: string | null; approved: boolean; history_range: string | null; message_id: string | null; preview: string | null; sent_at: string | null; direction: string | null; message_count: number };
export type AppleProductivity = { appointments: { id: string; full_name: string; appointment_at: string }[]; reminders: { id: string; contact_id: string; full_name: string; title: string; due_at: string; source: 'contact' | 'task' }[] };
