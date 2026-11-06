import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mapInBatches, prepareProvisionInputs, ProvisionStageTimings } from '../ProvisionConcurrency';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

test('catalog batches cap outstanding requests and preserve source order', async () => {
  const tasks = Array.from({ length: 9 }, () => deferred<number>());
  const started: number[] = [];
  let active = 0;
  let peak = 0;
  const result = mapInBatches(tasks, 3, async (task) => {
    const index = tasks.indexOf(task);
    started.push(index);
    peak = Math.max(peak, ++active);
    try { return await task.promise; } finally { active--; }
  });
  await Promise.resolve();
  assert.deepEqual(started, [0, 1, 2]);
  // Finish each batch backwards; output must still match sequential selection.
  for (let offset = 0; offset < tasks.length; offset += 3) {
    for (let index = offset + 2; index >= offset; index--) tasks[index].resolve(index);
    // Let the completed batch release the next batch.
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  assert.deepEqual(await result, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(peak, 3);
});

test('failed catalog batches drain reads and never schedule the next batch', async () => {
  const other = deferred<number>();
  const error = new Error('catalog unavailable');
  const started: number[] = [];
  let settled = false;
  const result = mapInBatches([0, 1, 2], 2, async index => {
    started.push(index);
    if (index === 0) throw error;
    return other.promise;
  });
  const checked = assert.rejects(result, candidate => candidate === error).then(() => { settled = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  other.resolve(1);
  await checked;
  assert.deepEqual(started, [0, 1]);
});

test('address ingestion and map geometry begin together and return both inputs', async () => {
  const writes = deferred<number>();
  const geometry = deferred<{ buildings: string[] }>();
  const started: string[] = [];
  const result = prepareProvisionInputs(
    () => { started.push('addresses'); return writes.promise; },
    () => { started.push('geometry'); return geometry.promise; }
  );
  await Promise.resolve();
  assert.deepEqual(started, ['addresses', 'geometry']);
  geometry.resolve({ buildings: ['house'] });
  writes.resolve(172);
  assert.deepEqual(await result, [172, { buildings: ['house'] }]);
});

test('geometry failure waits for address writes before retry handling can begin', async () => {
  const writes = deferred<number>();
  const error = new Error('geometry unavailable');
  let settled = false;
  const result = prepareProvisionInputs(() => writes.promise, async () => { throw error; });
  const checked = assert.rejects(result, candidate => candidate === error).then(() => { settled = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  writes.resolve(172);
  await checked;
});

test('synchronous address failure still drains geometry and preserves the error', async () => {
  const geometry = deferred<string>();
  const error = new Error('write failed');
  let geometryDone = false;
  const result = prepareProvisionInputs(
    () => { throw error; },
    async () => { const value = await geometry.promise; geometryDone = true; return value; }
  );
  const checked = assert.rejects(result, candidate => candidate === error);
  geometry.resolve('ready');
  await checked;
  assert.equal(geometryDone, true);
});

test('stage timing records failed stages and returns independent snapshots', async () => {
  const recorder = new ProvisionStageTimings();
  assert.equal(await recorder.measure('source_resolution_ms', async () => 172), 172);
  await assert.rejects(recorder.measure('geometry_load_ms', async () => { throw new Error('tile failed'); }), /tile failed/);
  const snapshot = recorder.snapshot();
  assert.equal(snapshot.version, 1);
  assert.ok(snapshot.stages.source_resolution_ms >= 0);
  assert.ok(snapshot.stages.geometry_load_ms >= 0);
  snapshot.stages.source_resolution_ms = -1;
  assert.ok(recorder.snapshot().stages.source_resolution_ms >= 0);
});
