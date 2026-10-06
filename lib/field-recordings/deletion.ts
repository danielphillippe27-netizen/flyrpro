import { z } from 'zod';
const manifestSchema = z.array(z.object({
  chunkId: z.uuid(), storagePath: z.string(), providerFileId: z.string().nullable(), transcriptionId: z.string().nullable(),
}).strict()).max(10000);
export function deletionStoragePaths(scope: { recordingId: string; userId: string; workspaceId: string }, manifest: unknown, chunks: { id: string; storage_path: string }[]) {
  const recording = z.uuid().parse(scope.recordingId).toLowerCase();
  const owner = z.uuid().parse(scope.userId).toLowerCase();
  const workspace = z.uuid().parse(scope.workspaceId).toLowerCase();
  const files = manifestSchema.parse(manifest);
  if (new Set(files.map(file => file.chunkId)).size !== files.length || new Set(files.map(file => file.storagePath)).size !== files.length || chunks.length !== files.length || new Set(chunks.map(chunk => chunk.id)).size !== chunks.length) throw new Error('Deletion manifest needs reconciliation');
  return files.map(file => {
    const expected = `${workspace}/${owner}/${recording}/${file.chunkId.toLowerCase()}.mp3`;
    if (file.storagePath !== expected || !chunks.some(chunk => chunk.id === file.chunkId && chunk.storage_path === expected)) throw new Error('Deletion path identity unavailable');
    return expected;
  });
}
/** Checkpoint only after every storage batch is confirmed. Callers must validate scope first. */
export async function removeDeletionStorage(paths: string[], remove: (batch: string[]) => Promise<void>, checkpoint: () => Promise<void>) {
  for (let start = 0; start < paths.length; start += 100) await remove(paths.slice(start, start + 100));
  await checkpoint();
}

/** A failed recording stays pending without blocking other cleanup or transcription. */
export async function cleanupDeletionEntries<T>(entries: T[], cleanup: (entry: T) => Promise<void>, defer?: (entry: T) => Promise<void>) {
  let storageCleaned = 0;
  let storageCleanupFailed = 0;
  for (const entry of entries) {
    try { await cleanup(entry); storageCleaned++; }
    catch { storageCleanupFailed++; if (defer) await defer(entry); }
  }
  return { storageCleaned, storageCleanupFailed };
}
