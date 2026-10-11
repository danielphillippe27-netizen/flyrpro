import { NextRequest, NextResponse } from 'next/server';
import { stormContext } from '@/lib/storm-maps/intelligence/access';
import { stormTerritorySchema } from '@/lib/storm-maps/intelligence/storm-territories';
export async function GET(request: NextRequest) {
  const c = await stormContext(request); if ('response' in c) return c.response;
  const { data, error } = await c.admin.from('storm_territories').select('id,name,boundary,context,created_at').eq('workspace_id', c.workspaceId).order('created_at', { ascending: false }).limit(200);
  if (error) return NextResponse.json({ error: 'Storm territories are unavailable. The database migration may be pending.' }, { status: 503 });
  return NextResponse.json({ territories: data }, { headers: { 'Cache-Control': 'private, no-store' } });
}
export async function POST(request: NextRequest) {
  const c = await stormContext(request); if ('response' in c) return c.response;
  const text = await request.text();
  if (text.length > 100_000) return NextResponse.json({ error: 'Territory boundary is too large.' }, { status: 413 });
  let raw: unknown; try { raw = JSON.parse(text); } catch { return NextResponse.json({ error: 'Invalid territory.' }, { status: 400 }); }
  const parsed = stormTerritorySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Choose a name and a valid, non-crossing storm territory smaller than 500 km².' }, { status: 400 });
  const context = { ...parsed.data.context }; delete context.territoryId;
  const { data, error } = await c.admin.from('storm_territories').insert({ workspace_id: c.workspaceId, created_by: c.user.id, ...parsed.data, context }).select('id,name,boundary,context,created_at').single();
  if (error) return NextResponse.json({ error: 'Could not save the territory. Retry after the database migration is applied.' }, { status: 503 });
  return NextResponse.json({ territory: data }, { status: 201 });
}
