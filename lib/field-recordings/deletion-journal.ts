import { z } from 'zod';
const entrySchema = z.object({ recordingId: z.uuid(), requestId: z.uuid() }).strict();
type Entry = z.infer<typeof entrySchema>;
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
function prefix(owner: string, workspace: string) {
  return `wolfgrid:deletion:v1:${z.uuid().parse(owner).toLowerCase()}:${z.uuid().parse(workspace).toLowerCase()}:`;
}
export function pendingRecordingDeletions(storage: Storage, owner: string, workspace: string): Entry[] {
  const scope = prefix(owner, workspace);
  const entries: Entry[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(scope)) continue;
    const raw = storage.getItem(key);
    if (!raw) throw new Error('Deletion recovery state unavailable');
    const entry = entrySchema.parse(JSON.parse(raw));
    if (key !== scope + entry.recordingId.toLowerCase()) throw new Error('Deletion recovery identity changed');
    entries.push(entry);
  }
  return entries.sort((a, b) => a.recordingId.localeCompare(b.recordingId));
}
export function persistRecordingDeletion(storage: Storage, owner: string, workspace: string, value: Entry): Entry {
  const entry = entrySchema.parse(value);
  const key = prefix(owner, workspace) + entry.recordingId.toLowerCase();
  const raw = storage.getItem(key);
  if (raw) {
    const saved = entrySchema.parse(JSON.parse(raw));
    if (saved.recordingId.toLowerCase() !== entry.recordingId.toLowerCase() || saved.requestId.toLowerCase() !== entry.requestId.toLowerCase()) throw new Error('Recover the saved deletion request first');
    return saved;
  }
  storage.setItem(key, JSON.stringify(entry));
  return entry;
}
/** Clear only after a definite rejection or final reconciliation; a hidden recording is not completion. */
export function clearRecordingDeletion(storage: Storage, owner: string, workspace: string, recording: string, request: string) {
  const key = prefix(owner, workspace) + z.uuid().parse(recording).toLowerCase();
  const raw = storage.getItem(key);
  if (!raw) return;
  const saved = entrySchema.parse(JSON.parse(raw));
  if (saved.recordingId.toLowerCase() !== recording.toLowerCase() || saved.requestId.toLowerCase() !== z.uuid().parse(request).toLowerCase()) throw new Error('Deletion request identity changed');
  storage.removeItem(key);
}
