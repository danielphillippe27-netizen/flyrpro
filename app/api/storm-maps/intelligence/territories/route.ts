import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { stormContext } from '@/lib/storm-maps/intelligence/access';
import { containedStormArea, effectiveStormArea } from '@/lib/storm-maps/intelligence/geometry';
import { stormTerritorySchema, normalizeStormDrawingContext } from '@/lib/storm-maps/intelligence/storm-territories';
export async function GET(request: NextRequest) {
  const c = await stormContext(request); if ('response' in c) return c.response;
  const id = request.nextUrl.searchParams.get('id');
  if (id && !z.uuid().safeParse(id).success) return NextResponse.json({ error: 'Invalid territory ID.' }, { status: 400 });
  let query = c.admin.from('storm_territories').select('*').eq('workspace_id', c.workspaceId);
  if (id) query = query.eq('id', id);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(id ? 1 : 200);
  if (error) return NextResponse.json({ error: 'Storm territories are unavailable. The database migration may be pending.' }, { status: 503 });
  return NextResponse.json({ territories: data }, { headers: { 'Cache-Control': 'private, no-store' } });
}
export async function POST(request: NextRequest) {
  const c = await stormContext(request); if ('response' in c) return c.response;
  const text = await request.text();
  if (text.length > 100_000) return NextResponse.json({ error: 'Territory boundary is too large.' }, { status: 413 });
  let raw: unknown; try { raw = JSON.parse(text); } catch { return NextResponse.json({ error: 'Invalid territory.' }, { status: 400 }); }
  const parsed = stormTerritorySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'Choose a name and a valid, non-crossing storm territory smaller than 5,000 km².' }, { status: 400 });
  parsed.data.context = normalizeStormDrawingContext(parsed.data.context);
  if(parsed.data.context.evidenceKind==='hail-sampled' && (parsed.data.context.selection!=='intensity-zone'||!parsed.data.context.sampling||parsed.data.context.minimumHailMM==null))return NextResponse.json({error:'Choose a numerical hail zone first.'},{status:400});
  if(parsed.data.context.evidenceKind==='wind-field'&&(parsed.data.context.event.hazard!=='hurricane'||!parsed.data.context.windSelection||parsed.data.context.selection!=='intensity-zone'))return NextResponse.json({error:'Select a hurricane wind area first.'},{status:400});
  if(parsed.data.context.reportSelection&&(parsed.data.context.event.hazard!=='tornado'||parsed.data.context.evidenceKind!=='reports'||parsed.data.context.selection!=='user-drawn'))return NextResponse.json({error:'Choose a tornado prospecting area.'},{status:400});
  let zoneFields = {};
  if(parsed.data.context.evidenceKind==='hail-size'){
    const {data:flags}=await c.admin.from('storm_intelligence_rollout').select('geometry_enabled').eq('workspace_id',c.workspaceId).maybeSingle();
    if(!flags?.geometry_enabled||!parsed.data.context.zoneId)return NextResponse.json({error:'Validated severity geometry is not enabled for this workspace.'},{status:409});
    const {data:zone,error:zoneError}=await c.admin.from('storm_severity_zones').select('id,event_key,minimum_mm,geometry').eq('id',parsed.data.context.zoneId).eq('event_key',parsed.data.context.event.key).eq('validated',true).eq('license_verified',true).maybeSingle();
    if(zoneError||!zone)return NextResponse.json({error:'The selected severity zone is unavailable. Reload the storm.'},{status:409});
    if(!containedStormArea(parsed.data.boundary,zone.geometry))return NextResponse.json({error:'The territory must remain inside the selected severity zone.'},{status:400});
    parsed.data.context.minimumHailMM=Number(zone.minimum_mm);
    parsed.data.context.maximumHailMM=undefined;
    parsed.data.context.includeOutsideZone=false;
    zoneFields={event_key:zone.event_key,zone_id:zone.id,effective_geometry:effectiveStormArea(parsed.data.boundary,zone.geometry),include_outside_zone:false};
  }
  const context = { ...parsed.data.context,version:2 as const }; delete context.territoryId;delete context.territoryRevision;
  const { data, error } = await c.admin.from('storm_territories').insert({ workspace_id: c.workspaceId, created_by: c.user.id, ...parsed.data, context, ...zoneFields }).select('*').single();
  if (error) return NextResponse.json({ error: 'Could not save the territory. Retry after the database migration is applied.' }, { status: 503 });
  return NextResponse.json({ territory: data }, { status: 201 });
}

export async function PATCH(request:NextRequest){
 const c=await stormContext(request);if('response'in c)return c.response;
 const raw=await request.json().catch(()=>null);
 const parsed=z.object({id:z.uuid(),name:z.string().trim().min(1).max(160).optional(),boundary:stormTerritorySchema.shape.boundary.optional(),revision:z.number().int().positive()}).strict().safeParse(raw);
 if(!parsed.success)return NextResponse.json({error:'Invalid territory edit.'},{status:400});
 const {data:existing,error:readError}=await c.admin.from('storm_territories').select('*').eq('workspace_id',c.workspaceId).eq('id',parsed.data.id).maybeSingle();
 if(readError)return NextResponse.json({error:'Territory editing requires the new database migration.'},{status:503});
 if(!existing)return NextResponse.json({error:'Territory not found.'},{status:404});
 if(existing.created_by!==c.user.id&&!['owner','admin'].includes(c.role??''))return NextResponse.json({error:'Only the creator or workspace administrators can edit this territory.'},{status:403});
 if(existing.zone_id&&parsed.data.boundary)return NextResponse.json({error:'Validated storm-zone boundary editing is not enabled yet.'},{status:409});
 const {id,revision,...changes}=parsed.data;
 const {data,error}=await c.admin.from('storm_territories').update(changes).eq('workspace_id',c.workspaceId).eq('id',id).eq('revision',revision).select('*').maybeSingle();
 if(error)return NextResponse.json({error:'Could not update territory.'},{status:503});
 if(!data)return NextResponse.json({error:'Territory changed. Reload before editing.'},{status:409});
 return NextResponse.json({territory:data});
}
export async function DELETE(request:NextRequest){
 const c=await stormContext(request);if('response'in c)return c.response;
 const id=request.nextUrl.searchParams.get('id');if(!z.uuid().safeParse(id).success)return NextResponse.json({error:'Invalid territory ID.'},{status:400});
 const {data}=await c.admin.from('storm_territories').select('created_by').eq('workspace_id',c.workspaceId).eq('id',id!).maybeSingle();
 if(!data)return NextResponse.json({error:'Territory not found.'},{status:404});
 if(data.created_by!==c.user.id&&!['owner','admin'].includes(c.role??''))return NextResponse.json({error:'Only the creator or administrators can delete this territory.'},{status:403});
 const {error}=await c.admin.from('storm_territories').delete().eq('workspace_id',c.workspaceId).eq('id',id!);
 return error?NextResponse.json({error:'Could not delete territory.'},{status:503}):NextResponse.json({deleted:true});
}
