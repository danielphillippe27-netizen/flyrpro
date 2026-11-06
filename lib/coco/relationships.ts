import { z } from 'zod';
const uuid = z.string().uuid();
export const specialField = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(['text', 'date']),
  value: z.string().max(1000),
}).strict().refine(f => f.type !== 'date' || !f.value || /^\d{4}-\d{2}-\d{2}$/.test(f.value) && !Number.isNaN(Date.parse(`${f.value}T00:00:00Z`)) && new Date(`${f.value}T00:00:00Z`).toISOString().slice(0, 10) === f.value, 'Enter a valid date');
export type SpecialField = z.infer<typeof specialField>;
export const relationshipCommand = z.discriminatedUnion('action', [
  z.object({ workspaceId: uuid, action: z.literal('fields'), contactId: uuid, version: z.number().int().nonnegative(), fields: z.array(specialField).max(40).refine(fields => new Set(fields.map(f => f.name.toLowerCase())).size === fields.length, 'Field names must be unique') }).strict(),
  z.object({ workspaceId: uuid, action: z.literal('outreach'), requestId: uuid, ids: z.array(uuid).min(1).max(500), kind: z.enum(['follow-up', 'letter-prepared', 'letter-mailed', 'call', 'email', 'text', 'visit', 'note']), title: z.string().trim().min(1).max(200), body: z.string().max(10000), at: z.string().datetime({ offset: true }) }).strict(),
]);
export type RelationshipData = { fields: SpecialField[]; version: number; events: { id: string; kind: string; title: string; body: string; occurred_at: string }[] };
export async function relationshipApi<T>(userId: string, workspaceId: string, payload?: Record<string, unknown>, contactId?: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/coco/relationships?workspaceId=${encodeURIComponent(workspaceId)}&contactId=${encodeURIComponent(contactId ?? '')}`, { credentials: 'include', cache: 'no-store', signal, headers: { 'x-wolfgrid-user-id': userId, ...(payload ? { 'Content-Type': 'application/json' } : {}) }, ...(payload ? { method: 'POST', body: JSON.stringify({ workspaceId, ...payload }) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not save relationship details.');
  return result;
}
export function letterText(template: string, client: { first_name: string; last_name: string; address: string | null }) {
  return template.replace(/\{(first_name|last_name|address)\}/g, (_, key: 'first_name' | 'last_name' | 'address') => client[key] || '');
}
export function escapeLetter(value: string) { return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); }
