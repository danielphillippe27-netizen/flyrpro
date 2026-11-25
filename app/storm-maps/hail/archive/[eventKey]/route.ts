import { createAdminClient } from '@/lib/supabase/server';
import { mrmsHailStoragePath } from '@/lib/storm-maps/intelligence/mrms-hail-overlay';

export const runtime = 'nodejs';

export async function GET(_request: Request, { params }: { params: Promise<{ eventKey: string }> }) {
  const { eventKey } = await params;
  const path = eventKey.endsWith('.png') ? mrmsHailStoragePath(eventKey.slice(0, -4)) : null;
  if (!path) return new Response(null, { status: 404 });

  const { data, error } = await createAdminClient().storage.from('storm-archive').download(path);
  if (error || !data || data.type !== 'image/png' || !data.size || data.size > 2_000_000) {
    return new Response(null, { status: 404 });
  }
  return new Response(data.stream(), { headers: {
    'Content-Type': 'image/png',
    'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400',
    'X-Content-Type-Options': 'nosniff',
  } });
}
