import { z } from 'zod';
export const preferenceSchema = z.object({ requestId: z.uuid(), version: z.number().int().positive(), contactId: z.uuid(), addressId: z.uuid(), proposalIndex: z.number().int().min(0).max(19), confirmed: z.literal(true) }).strict();
export type PreferencePayload = z.infer<typeof preferenceSchema>;
const receiptSchema = z.object({ conversationId: z.uuid(), version: z.number().int().positive(), contactId: z.uuid(), doNotContact: z.literal(true), requestId: z.uuid() }).strict();
export function checkedPreferenceReceipt(value: unknown, conversationId: string, payload: PreferencePayload) {
  const receipt = receiptSchema.parse(value);
  if (receipt.conversationId !== conversationId || receipt.contactId !== payload.contactId || receipt.requestId !== payload.requestId || receipt.version !== payload.version + 1) throw new Error('Preference receipt needs reconciliation');
  return receipt;
}
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function preferenceStorageKey(owner: string, workspace: string, recording: string, conversation: string) {
  return 'wolfgrid:field-contact-preference:v1:' + [owner, workspace, recording, conversation].map(id => z.uuid().parse(id).toLowerCase()).join(':');
}
export function restorePreference(store: Store, key: string): PreferencePayload | null {
  const raw = store.getItem(key);
  return raw === null ? null : preferenceSchema.parse(JSON.parse(raw));
}
export function persistPreference(store: Store, key: string, payload: PreferencePayload) {
  const validated = preferenceSchema.parse(payload), prior = restorePreference(store, key);
  if (prior && JSON.stringify(prior) !== JSON.stringify(validated)) throw new Error('Recover the saved preference before changing selections');
  store.setItem(key, JSON.stringify(validated));
}
export function clearPreference(store: Store, key: string, payload: PreferencePayload) {
  const prior = restorePreference(store, key);
  if (prior && JSON.stringify(prior) !== JSON.stringify(preferenceSchema.parse(payload))) throw new Error('Saved preference changed');
  store.removeItem(key);
}
export type PendingPreference = { key: string; recordingId: string; conversationId: string; payload: PreferencePayload };
export function pendingPreferences(store: Pick<Storage, 'length' | 'key' | 'getItem'>, owner: string, workspace: string): PendingPreference[] {
  const prefix = `wolfgrid:field-contact-preference:v1:${z.uuid().parse(owner).toLowerCase()}:${z.uuid().parse(workspace).toLowerCase()}:`;
  const entries: PendingPreference[] = [];
  for (let index = 0; index < store.length; index++) {
    const key = store.key(index);
    if (!key?.startsWith(prefix)) continue;
    const parts = key.slice(prefix.length).split(':');
    if (parts.length !== 2 || key !== preferenceStorageKey(owner, workspace, parts[0], parts[1])) throw new Error('Saved preference identity changed');
    const raw = store.getItem(key);
    if (raw === null) continue; // Another tab may have just reconciled this entry.
    entries.push({ key, recordingId: parts[0], conversationId: parts[1], payload: preferenceSchema.parse(JSON.parse(raw)) });
  }
  return entries.sort((a, b) => a.key.localeCompare(b.key));
}
/** Recovery uses only the immutable saved request, independently of transcript availability. */
export async function recoverSavedPreference(store: Store, entry: PendingPreference, workspace: string, signal: AbortSignal, transport: typeof fetch = fetch) {
  z.uuid().parse(workspace);
  const saved = restorePreference(store, entry.key);
  if (!saved || JSON.stringify(saved) !== JSON.stringify(preferenceSchema.parse(entry.payload))) throw new Error('Saved preference changed');
  const endpoint = `/api/field-recordings/${z.uuid().parse(entry.recordingId)}/conversations/${z.uuid().parse(entry.conversationId)}/contact-preference?workspaceId=${encodeURIComponent(workspace)}`;
  signal.throwIfAborted();
  let response = await transport(`${endpoint}&requestId=${encodeURIComponent(saved.requestId)}`, { cache: 'no-store', redirect: 'error', signal });
  signal.throwIfAborted();
  if (response.status === 404) {
    response = await transport(endpoint, { method: 'POST', redirect: 'error', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(saved) });
    signal.throwIfAborted();
    if ([400, 409].includes(response.status)) {
      clearPreference(store, entry.key, saved);
      return { kind: 'rejected' as const };
    }
  }
  if (!response.ok) throw new Error('Preference confirmation unavailable');
  const receipt = checkedPreferenceReceipt(await response.json(), entry.conversationId, saved);
  signal.throwIfAborted();
  clearPreference(store, entry.key, saved);
  return { kind: 'confirmed' as const, version: receipt.version };
}
