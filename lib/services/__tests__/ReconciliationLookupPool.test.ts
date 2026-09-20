import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconciliationLookupPool } from '../ReconciliationLookupPool';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};

test('starts later groups while an earlier lookup is blocked, preserves order and six-slot cap', async () => {
  const slow = deferred();
  const laterGroup = deferred();
  let active = 0, peak = 0;
  const counts: number[] = [];
  const items = Array.from({ length: 60 }, (_, i) => i);
  const pending = reconciliationLookupPool(items, async i => {
    peak = Math.max(peak, ++active);
    if (i === 0) await slow.promise;
    if (i === 30) laterGroup.resolve();
    await Promise.resolve();
    active--;
    return i;
  }, async count => { counts.push(count); });
  await laterGroup.promise;
  assert.ok(active > 0);
  slow.resolve();
  assert.deepEqual(await pending, items);
  assert.equal(peak, 6);
  assert.equal(counts.at(-1), 60);
  assert.ok(counts.every((value, i) => i === 0 || value > counts[i - 1]));
});

test('a slow heartbeat never blocks lookup slots and progress writes stay serialized', async () => {
  const heartbeat = deferred();
  const allLookups = deferred();
  let done = 0, activeWrites = 0, peakWrites = 0;
  const counts: number[] = [];
  const pending = reconciliationLookupPool(Array.from({ length: 80 }, (_, i) => i), async i => {
    if (++done === 80) allLookups.resolve();
    return i;
  }, async count => {
    peakWrites = Math.max(peakWrites, ++activeWrites);
    counts.push(count);
    await heartbeat.promise;
    activeWrites--;
  });
  await allLookups.promise;
  heartbeat.resolve();
  await pending;
  assert.equal(peakWrites, 1);
  assert.equal(counts.at(-1), 80);
});

test('heartbeat failure drains active work and rejects before caller can release the lease', async () => {
  let active = 0;
  await assert.rejects(reconciliationLookupPool(Array.from({ length: 80 }, (_, i) => i), async i => {
    active++;
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    return i;
  }, async () => { throw new Error('database unavailable'); }), /database unavailable/);
  assert.equal(active, 0);
});

test('deadline stops new lookups and drains already running lookups', async () => {
  let now = 0, active = 0, started = 0;
  await assert.rejects(reconciliationLookupPool(Array.from({ length: 80 }, (_, i) => i), async i => {
    active++; started++;
    await Promise.resolve();
    now = 100;
    active--;
    return i;
  }, async () => {}, { deadline: 50, now: () => now }), /budget exhausted/);
  assert.equal(started, 6);
  assert.equal(active, 0);
});

test('small and empty campaigns do not lose final progress or fabricate work', async () => {
  const counts: number[] = [];
  assert.deepEqual(await reconciliationLookupPool([], async x => x, async n => { counts.push(n); }), []);
  assert.equal(counts.length, 0);
  assert.deepEqual(await reconciliationLookupPool([1, 2], async x => x * 2, async n => { counts.push(n); }), [2, 4]);
  assert.deepEqual(counts, [2]);
});
