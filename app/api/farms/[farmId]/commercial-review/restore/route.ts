import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { formatApiError, selectFarmCampaignRow, userCanAccessFarm } from '@/app/api/farms/_utils/backingCampaign';
import { createAdminClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest, context: { params: Promise<{ farmId: string }> }) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { farmId } = await context.params;
    const admin = createAdminClient();
    const { farm } = await selectFarmCampaignRow(admin, farmId);
    if (!farm) return NextResponse.json({ error: 'Farm not found' }, { status: 404 });
    if (!await userCanAccessFarm(admin, user.id, farm)) return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    const { addressId } = await request.json();
    if (typeof addressId !== 'string') return NextResponse.json({ error: 'Address required' }, { status: 400 });
    const { data: exclusion, error } = await admin.from('farm_commercial_exclusions').select('address_data').eq('farm_id', farmId).eq('address_id', addressId).is('restored_at', null).maybeSingle();
    if (error) throw error;
    if (!exclusion) return NextResponse.json({ error: 'Excluded address not found' }, { status: 404 });
    const { error: insertError } = await admin.from('farm_addresses').upsert({ ...exclusion.address_data, id: addressId, farm_id: farmId }, { onConflict: 'id', ignoreDuplicates: true });
    if (insertError) throw insertError;
    const marked = await admin.from('farm_commercial_exclusions').update({ restored_at: new Date().toISOString() }).eq('farm_id', farmId).eq('address_id', addressId);
    if (marked.error) throw marked.error;
    const { count, error: countError } = await admin.from('farm_addresses').select('id', { count: 'exact', head: true }).eq('farm_id', farmId);
    if (countError) throw countError;
    const updated = await admin.from('farms').update({ address_count: count ?? 0 }).eq('id', farmId);
    if (updated.error) throw updated.error;
    return NextResponse.json({ totalCount: count });
  } catch (error) { return NextResponse.json({ error: formatApiError(error) }, { status: 500 }); }
}
