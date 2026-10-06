import assert from 'node:assert/strict';
import { cleanupDeletionEntries, removeDeletionStorage } from '../deletion';
async function main() {
  const paths = Array.from({ length: 205 }, (_, index) => `file-${index}`);
  const remaining = new Set(paths);
  let checkpointed = false;
  let batches = 0;
  await assert.rejects(removeDeletionStorage(paths, async batch => {
    batches++;
    if (batches === 2) throw new Error('Storage outage');
    batch.forEach(path => remaining.delete(path));
  }, async () => { checkpointed = true; }));
  assert.equal(remaining.size, 105);
  assert.equal(checkpointed, false);
  const retriedBatches: number[] = [];
  await removeDeletionStorage(paths, async batch => {
    retriedBatches.push(batch.length);
    batch.forEach(path => remaining.delete(path));
  }, async () => { assert.equal(remaining.size, 0); checkpointed = true; });
  assert.deepEqual(retriedBatches, [100, 100, 5]);
  assert.equal(checkpointed, true);
  let removed = 0;
  await assert.rejects(removeDeletionStorage(paths, async batch => { removed += batch.length; }, async () => { throw new Error('Checkpoint outage'); }));
  assert.equal(removed, 205);
  let emptyCheckpoint = false;
  await removeDeletionStorage([], async () => { throw new Error('Unexpected storage request'); }, async () => { emptyCheckpoint = true; });
  assert.equal(emptyCheckpoint, true);
  const attempted: string[] = [];
  const deferred: string[] = [];
  const failedQueue = ['invalid-manifest', 'storage-outage', 'healthy'];
  const result = await cleanupDeletionEntries(failedQueue, async entry => {
    attempted.push(entry);
    if (entry !== 'healthy') throw new Error('Cleanup unavailable');
  }, async entry => { deferred.push(entry); });
  assert.deepEqual(attempted, failedQueue);
  assert.deepEqual(deferred, failedQueue.slice(0, 2));
  assert.deepEqual(result, { storageCleaned: 1, storageCleanupFailed: 2 });
  assert.deepEqual(await cleanupDeletionEntries([], async () => { throw new Error('Unexpected cleanup'); }), { storageCleaned: 0, storageCleanupFailed: 0 });
  await assert.rejects(cleanupDeletionEntries(['failed'], async () => { throw new Error('Storage outage'); }, async () => { throw new Error('Retry checkpoint outage'); }));
  console.log('Deletion batch failure, retry, checkpoint failure and empty-manifest control flow passed; real storage idempotency remains unverified');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
