import { NextRequest, NextResponse } from 'next/server';
import { stormContext, stormError } from '@/lib/storm-maps/intelligence/access';
import { savedStormArchiveFilter, savedStormArchiveOffset, SAVED_STORM_PAGE_SIZE } from '@/lib/storm-maps/intelligence/saved-history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const context = await stormContext(request);
  if ('response' in context) return context.response;
  const params = request.nextUrl.searchParams;
  const filter = savedStormArchiveFilter(params.get('country'), params.get('hazard'));
  const offset = savedStormArchiveOffset(params.get('cursor'));
  if (!filter || offset == null) return NextResponse.json({ error: 'Choose a valid country, storm type and archive page.' }, { status: 400 });
  try {
    const query = () => context.admin.from('storm_events').select('event_key,event_start,metadata')
      .eq('hazard', filter.hazard).eq('source', filter.source).like('event_key', filter.keyPattern);
    const [page, first] = await Promise.all([
      query().order('event_start', { ascending: false }).order('event_key').range(offset, offset + SAVED_STORM_PAGE_SIZE),
      query().order('event_start').order('event_key').limit(1).maybeSingle(),
    ]);
    if (page.error || first.error) throw new Error('Saved storm history is unavailable. Please retry.');
    const rows = page.data ?? [];
    return NextResponse.json({
      events: rows.slice(0, SAVED_STORM_PAGE_SIZE).map(row => row.metadata),
      nextCursor: rows.length > SAVED_STORM_PAGE_SIZE ? String(offset + SAVED_STORM_PAGE_SIZE) : null,
      archiveStartsAt: first.data?.event_start ?? null,
      coverage: 'Permanently saved storm records, newest first. Older weather shading may be unavailable. Missing records do not establish no storms.',
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return stormError(error); }
}
