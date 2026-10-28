import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { formatApiError, selectFarmCampaignRow, userCanAccessFarm } from '@/app/api/farms/_utils/backingCampaign';
import type { DurhamFarmAddress } from '@/lib/farms/durhamPlaces';
import { matchDurhamFarmAddresses } from '@/lib/farms/durhamSnapshot';
import { createAdminClient } from '@/lib/supabase/server';
import { fetchAllInPages } from '@/lib/supabase/fetchAllInPages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, context: { params: Promise<{ farmId: string }> }) {
  try {
    const user = await resolveUserFromRequest(request);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { farmId } = await context.params;
    const admin = createAdminClient();
    const { farm } = await selectFarmCampaignRow(admin, farmId);
    if (!farm) return NextResponse.json({ error: 'Farm not found' }, { status: 404 });
    if (!await userCanAccessFarm(admin, user.id, farm)) return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    const addresses = await fetchAllInPages<DurhamFarmAddress>(async (from, to) => await admin.from('farm_addresses')
        .select('id, formatted, house_number, street_name, latitude, longitude')
        .eq('farm_id', farmId).order('id').range(from, to));
    const review = await matchDurhamFarmAddresses(addresses);
    const excluded = await fetchAllInPages(async (from, to) => await admin.from('farm_commercial_exclusions')
      .select('address_id,address_data,places').eq('farm_id', farmId).is('restored_at', null).order('address_id').range(from, to));
    return NextResponse.json({ ...review, farmAddressCount: addresses.length,
      matchedAddressCount: review.matches.length, excluded: excluded ?? [] });
  } catch (error) {
    return NextResponse.json({ error: formatApiError(error) }, { status: 500 });
  }
}
