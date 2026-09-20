/** Ordered results with a continuous pool; progress writes never block free lookup slots. */
export async function reconciliationLookupPool<T, R>(
  items: T[],
  work: (item: T) => Promise<R>,
  progress: (completed: number) => Promise<void>,
  options: { deadline?: number; now?: () => number } = {},
): Promise<R[]> {
  const now = options.now ?? Date.now;
  const results = new Array<R>(items.length);
  let next = 0;
  let completed = 0;
  let published = 0;
  let lastProgress = now();
  let progressTask: Promise<void> | undefined;
  let failure: unknown;
  let failed = false;
  const fail = (error: unknown) => { if (!failed) { failure = error; failed = true; } };
  const publish = () => {
    if (progressTask || failed || completed === published) return;
    const count = completed;
    progressTask = Promise.resolve().then(() => progress(count)).then(() => {
      published = count;
      lastProgress = now();
    }).catch(fail).finally(() => { progressTask = undefined; });
  };
  await Promise.all(Array.from({ length: Math.min(6, items.length) }, async () => {
    while (!failed && next < items.length) {
      if (options.deadline !== undefined && now() >= options.deadline) {
        fail(new Error('Reconciliation lookup budget exhausted; queued for recovery'));
        break;
      }
      const index = next++;
      try {
        results[index] = await work(items[index]);
        completed++;
        if (completed - published >= 24 || now() - lastProgress >= 5_000) publish();
      } catch (error) { fail(error); }
    }
  }));
  // Drain both lookups and progress before the caller releases or retries the lease.
  await progressTask;
  if (failed) throw failure;
  if (published !== completed) { publish(); await progressTask; }
  if (failed) throw failure;
  return results;
}
