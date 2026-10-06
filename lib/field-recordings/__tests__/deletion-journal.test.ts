import assert from 'node:assert/strict';
import { clearRecordingDeletion, pendingRecordingDeletions, persistRecordingDeletion } from '../deletion-journal';
class MemoryStorage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
const owner = '69bb48e3-b4a7-4274-85dd-a859b63be6c1';
const workspace = 'd1c13c9e-7bdd-4abd-ac17-7239ecfed290';
const other = 'bce57c78-40df-4c57-9d89-1f3b86c42f04';
const entry = { recordingId: '9ed12a51-cbdc-4bd3-b5df-fec316a5cf26', requestId: '3ab7f2df-5b3e-49c2-b2cb-05c36103eaac' };
const storage = new MemoryStorage();
persistRecordingDeletion(storage, owner, workspace, entry);
assert.deepEqual(pendingRecordingDeletions(storage, owner, workspace), [entry]);
assert.deepEqual(pendingRecordingDeletions(storage, other, workspace), []);
assert.deepEqual(pendingRecordingDeletions(storage, owner, other), []);
assert.throws(() => persistRecordingDeletion(storage, owner, workspace, { ...entry, requestId: other }));
assert.throws(() => clearRecordingDeletion(storage, owner, workspace, entry.recordingId, other));
assert.deepEqual(pendingRecordingDeletions(storage, owner, workspace), [entry]);
clearRecordingDeletion(storage, owner, workspace, entry.recordingId, entry.requestId);
assert.deepEqual(pendingRecordingDeletions(storage, owner, workspace), []);
const denied = new MemoryStorage();
denied.setItem = () => { throw new Error('Quota unavailable'); };
assert.throws(() => persistRecordingDeletion(denied, owner, workspace, entry));
assert.equal(denied.length, 0);
console.log('Deletion journal discovery, scope isolation, immutable retries, guarded clearing and persistence failure checks passed');
