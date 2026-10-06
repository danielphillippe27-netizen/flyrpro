import assert from 'node:assert/strict';
import { deletionStoragePaths } from '../deletion';
const scope = { recordingId: 'cf2265d6-a2fd-49d9-9117-79b29f9a6b32', userId: '050e4aa6-bb66-43b3-a33e-b0db780f8414', workspaceId: '3d4bc3a0-253b-4688-aec7-6cbd7469c62b' };
const chunkId = '75a1bb19-b114-4a3d-9673-63f8ec4a09fc';
const path = `${scope.workspaceId}/${scope.userId}/${scope.recordingId}/${chunkId}.mp3`;
const file = { chunkId, storagePath: path, providerFileId: null, transcriptionId: null };
const chunks = [{ id: chunkId, storage_path: path }];
assert.deepEqual(deletionStoragePaths(scope, [file], chunks), [path]);
assert.deepEqual(deletionStoragePaths(scope, [], []), []);
for (const invalidPath of [path.replace(scope.userId, scope.workspaceId), `${path}/../other.mp3`, `https://example.com/${path}`, path.replace('.mp3', '.wav')]) {
  assert.throws(() => deletionStoragePaths(scope, [{ ...file, storagePath: invalidPath }], [{ id: chunkId, storage_path: invalidPath }]));
}
assert.throws(() => deletionStoragePaths(scope, [file, file], [...chunks, ...chunks]));
assert.throws(() => deletionStoragePaths(scope, [file], []));
assert.throws(() => deletionStoragePaths(scope, [], chunks));
assert.throws(() => deletionStoragePaths(scope, [file], [{ ...chunks[0], storage_path: 'other' }]));
console.log('Deletion path ownership, recording/chunk identity, traversal, duplicate and manifest reconciliation checks passed');
