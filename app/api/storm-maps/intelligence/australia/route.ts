import { NextRequest, NextResponse } from 'next/server';
import { stormContext, stormError } from '@/lib/storm-maps/intelligence/access';
import { dateWindow } from '@/lib/storm-maps/intelligence/model';
import { australianHailHealth } from '@/lib/storm-maps/intelligence/australian-hail-history';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  const context = await stormContext(request); if ('response' in context) return context.response;
  const params = request.nextUrl.searchParams;
  let range; try { range = dateWindow(params.get('from') ?? '', params.get('to') ?? '', 366); } catch { return NextResponse.json({ error: 'Choose a valid date range of up to one year.' }, { status: 400 }); }
  const offset = Number(params.get('offset') ?? '0');
  if (!Number.isInteger(offset) || offset < 0 || offset > 100000) return NextResponse.json({ error: 'Invalid archive page.' }, { status: 400 });
  const minimumMM = Number(params.get('minimumMM') ?? '0');
  if (!Number.isFinite(minimumMM) || minimumMM < 0 || minimumMM > 150) return NextResponse.json({ error: 'Invalid hail-size threshold.' }, { status: 400 });
  try {
    let query = context.admin.from('storm_events').select('metadata', { count: 'exact' }).like('event_key', 'xweather:au:hail:%').gte('event_start', range.start).lt('event_start', range.end);
    if (minimumMM > 0) query = query.gte('metadata->maxHailMM', minimumMM);
    const [{ data, error, count }, health, first] = await Promise.all([
      query.order('event_start', { ascending: false }).order('event_key').range(offset, offset + 99),
      australianHailHealth(),
      context.admin.from('storm_events').select('event_start').like('event_key', 'xweather:au:hail:%').order('event_start').limit(1).maybeSingle(),
    ]);
    if (error || first.error) throw Error('Australian archive unavailable.');
    return NextResponse.json({ events: (data ?? []).map(row => row.metadata), total: count, nextOffset: offset + (data?.length ?? 0) < (count ?? 0) ? offset + 100 : null,
      archiveStartsAt: first.data?.event_start ?? null, health, coverage: 'Saved Australia-wide Xweather hail-threat detections. Modeled forecasts, not confirmed hail reports or damage footprints. Coverage begins with the retrieved seven-day window and grows as collection continues.' }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return stormError(error); }
}
