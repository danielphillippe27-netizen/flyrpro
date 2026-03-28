import type { PostgrestError } from '@supabase/supabase-js';

/** PostgREST default max-rows is 1000; paginate with .range(from, to) until exhausted. */
const PAGE_SIZE = 1000;

export async function fetchAllInPages<T>(
  fetchPage: (
    from: number,
    to: number
  ) => Promise<{ data: T[] | null; error: PostgrestError | null }>
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) throw error;
    const batch = data ?? [];
    if (!batch.length) break;
    out.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}
