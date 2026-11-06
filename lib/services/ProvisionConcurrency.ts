/** Bounded reads with stable ordering, including when requests finish out of order. */
export async function mapInBatches<T, R>(
  items: readonly T[],
  concurrency: number,
  read: (item: T) => Promise<R>
): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Invalid concurrency');
  const results: R[] = [];
  for (let offset = 0; offset < items.length; offset += concurrency) {
    const batch = await Promise.allSettled(items.slice(offset, offset + concurrency).map(item => Promise.resolve().then(() => read(item))));
    for (const result of batch) {
      if (result.status === 'rejected') throw result.reason;
      results.push(result.value);
    }
  }
  return results;
}

/** Drain both branches before allowing retry/failure handling to mutate campaign state. */
export async function prepareProvisionInputs<A, G>(
  saveAddresses: () => Promise<A>,
  loadGeometry: () => Promise<G>
): Promise<[A, G]> {
  const [addresses, geometry] = await Promise.allSettled([
    Promise.resolve().then(saveAddresses),
    Promise.resolve().then(loadGeometry),
  ]);
  if (addresses.status === 'rejected') throw addresses.reason;
  if (geometry.status === 'rejected') throw geometry.reason;
  return [addresses.value, geometry.value];
}

export class ProvisionStageTimings {
  private readonly startedAt = performance.now();
  private readonly stages: Record<string, number> = {};

  async measure<T>(name: string, operation: () => Promise<T>): Promise<T> {
    const startedAt = performance.now();
    try {
      return await operation();
    } finally {
      this.record(name, performance.now() - startedAt);
    }
  }

  record(name: string, ms: number): void {
    this.stages[name] = Math.max(0, Math.round(ms));
  }

  snapshot() {
    return {
      version: 1,
      total_ms: Math.round(performance.now() - this.startedAt),
      stages: { ...this.stages },
      counts: {},
      linker: {},
      updated_at: new Date().toISOString(),
    };
  }
}
