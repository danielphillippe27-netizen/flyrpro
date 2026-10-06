import { z } from 'zod';
export const applicationSchema = z.object({
  requestId: z.uuid(), version: z.number().int().positive(), contactId: z.uuid(), addressId: z.uuid(),
  saveNote: z.boolean(), actions: z.array(z.object({ proposalIndex: z.number().int().nonnegative(), dueAt: z.iso.datetime({ offset: true }) }).strict()).max(20),
}).strict().refine(value => value.saveNote || value.actions.length > 0, 'Select a note or action')
  .refine(value => new Set(value.actions.map(action => action.proposalIndex)).size === value.actions.length, 'Duplicate action selection');
export type ApplicationPayload = z.infer<typeof applicationSchema>;
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function applicationStorageKey(owner: string, workspace: string, recording: string, conversation: string) {
  return 'wolfgrid:field-application:v1:' + [owner, workspace, recording, conversation].map(value => z.uuid().parse(value).toLowerCase()).join(':');
}
export function restoreApplication(store: Store, key: string): ApplicationPayload | null {
  const raw = store.getItem(key);
  return raw === null ? null : applicationSchema.parse(JSON.parse(raw));
}
export function persistApplication(store: Store, key: string, payload: ApplicationPayload) {
  const validated = applicationSchema.parse(payload);
  const previous = restoreApplication(store, key);
  if (previous && JSON.stringify(previous) !== JSON.stringify(validated)) throw new Error('Recover the saved application before changing selections');
  store.setItem(key, JSON.stringify(validated));
}
