import { NextRequest, NextResponse } from 'next/server';
import { area, bbox } from '@turf/turf';
import type { Polygon, MultiPolygon } from 'geojson';
import { stormContext } from '@/lib/storm-maps/intelligence/access';
import { inspectionsWithin, overlapSquareMeters, reviewPolygonSchema, type InspectionRecord, type TerritoryReview } from '@/lib/storm-maps/intelligence/territory-review';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  const context = await stormContext(request);
  if ('response' in context) return context.response;
  // Bound both parse work and spatial work for this interactive review.
  const body = await request.text();
  if (body.length > 100_000) return NextResponse.json({error:'Boundary is too detailed.'},{status:413});
  let raw: unknown;
  try { raw = JSON.parse(body); } catch { return NextResponse.json({error:'Invalid boundary.'},{status:400}); }
  const parsed = reviewPolygonSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({error:'Draw a closed, non-crossing boundary smaller than 500 km².'},{status:400});
  const polygon = parsed.data as Polygon;
  const bounds = bbox(polygon);
  const manager = context.role === 'owner' || context.role === 'admin';
  let campaignsQuery = context.admin.from('campaigns').select('id,name,status,territory_boundary').eq('workspace_id',context.workspaceId).not('territory_boundary','is',null).order('created_at',{ascending:false}).limit(501);
  if (!manager) campaignsQuery = campaignsQuery.eq('owner_id',context.user.id);
  const [campaignResult, inspectionResult] = await Promise.all([
    campaignsQuery,
    context.admin.from('storm_property_inspections').select('id,event_key,longitude,latitude,property_label,outcome,observed_at').eq('workspace_id',context.workspaceId).gte('longitude',bounds[0]).lte('longitude',bounds[2]).gte('latitude',bounds[1]).lte('latitude',bounds[3]).order('observed_at',{ascending:false}).order('id',{ascending:false}).limit(501),
  ]);
  if (campaignResult.error || inspectionResult.error) return NextResponse.json({error:'Area review unavailable. Existing campaigns and inspections could not both be checked.'},{status:503});
  const warnings: string[] = [];
  if ((campaignResult.data?.length || 0) > 500) warnings.push('Only the 500 newest campaigns with boundaries were checked.');
  if ((inspectionResult.data?.length || 0) > 500) warnings.push('Only the 500 newest inspection records in this region were checked.');
  const totalArea = area(polygon);
  const campaigns: TerritoryReview['campaigns'] = [];
  for (const row of (campaignResult.data || []).slice(0,500)) {
    try {
      const boundary = row.territory_boundary as Polygon | MultiPolygon;
      if (!['Polygon','MultiPolygon'].includes(boundary?.type)) throw new Error('No polygon');
      const overlap = overlapSquareMeters(polygon,boundary);
      if (overlap > 1) campaigns.push({id:row.id,name:row.name,status:row.status,overlapKM2:overlap / 1e6,selectedAreaPercent:Math.min(100,overlap / totalArea * 100)});
    } catch { warnings.push('An existing campaign boundary could not be checked.'); }
  }
  const result: TerritoryReview = {
    areaKM2: totalArea / 1e6,
    campaigns: campaigns.sort((a,b) => b.selectedAreaPercent-a.selectedAreaPercent),
    inspections: inspectionsWithin((inspectionResult.data || []).slice(0,500).map(row=>({...row,notes:''})) as InspectionRecord[],polygon),
    scope: manager ? 'Workspace campaigns' : 'Your owned campaigns',
    complete: warnings.length === 0,
    warnings: [...new Set(warnings)],
  };
  return NextResponse.json(result,{headers:{'Cache-Control':'private, no-store'}});
}
