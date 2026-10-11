import { NextRequest, NextResponse } from 'next/server';
import { stormContext } from '@/lib/storm-maps/intelligence/access';
import { latestInspectionRecords, type InspectionRecord } from '@/lib/storm-maps/intelligence/territory-review';
export async function GET(request: NextRequest) {
  const context = await stormContext(request);
  if ('response' in context) return context.response;
  const {data,error} = await context.admin.from('storm_property_inspections')
    .select('id,event_key,longitude,latitude,property_label,outcome,notes,observed_at')
    .eq('workspace_id',context.workspaceId).order('observed_at',{ascending:false}).order('id',{ascending:false}).limit(501);
  if (error) return NextResponse.json({error:'Inspection worklist unavailable.'},{status:503});
  return NextResponse.json({inspections:latestInspectionRecords((data || []).slice(0,500) as InspectionRecord[]),truncated:(data?.length || 0)>500},{headers:{'Cache-Control':'private, no-store'}});
}
