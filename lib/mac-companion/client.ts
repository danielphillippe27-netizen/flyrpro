export type NativePerson = { externalId: string; fullName: string; phones: string[]; emails: string[] };
export type MacPreferences = { sync_enabled: boolean; ai_messages_enabled: boolean; revision: number; sync_consent_at?: string };
export type MacStatus = { userId: string; preferences: MacPreferences; devices: { device_id: string; status: string; last_seen_at: string }[] };
type NativeBridge = { postMessage: (input: Record<string, unknown>) => Promise<unknown> };
export function hasMacBridge() { return typeof window !== 'undefined' && !!(window as unknown as { webkit?: { messageHandlers?: { wolfgridMac?: NativeBridge } } }).webkit?.messageHandlers?.wolfgridMac; }
export async function macNative<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  const handler = (window as unknown as { webkit?: { messageHandlers?: { wolfgridMac?: NativeBridge } } }).webkit?.messageHandlers?.wolfgridMac;
  if (!handler) throw new Error('Open WolfGrid for Mac to use Apple integrations.');
  return await handler.postMessage({ action, ...data }) as T;
}
export class MacApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function macApi<T>(query: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const scoped = body && typeof body === 'object' ? body as Record<string, unknown> : undefined;
  const expectedUser = typeof scoped?.userId === 'string' ? scoped.userId : undefined;
  const payload = scoped ? Object.fromEntries(Object.entries(scoped).filter(([key]) => key !== 'userId')) : body;
  const response = await fetch(`/api/mac-companion${query}`, { credentials: 'include', cache: 'no-store', signal, ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json', ...(expectedUser ? { 'x-wolfgrid-user-id': expectedUser } : {}) }, body: JSON.stringify(payload) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new MacApiError(result.error || 'Mac connection unavailable.', response.status);
  return result;
}
