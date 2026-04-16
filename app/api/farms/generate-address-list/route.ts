import { NextRequest, NextResponse } from 'next/server';
import {
  formatApiError,
  resolveBackingCampaignId,
  selectFarmCampaignRow,
  userCanAccessFarm,
} from '@/app/api/farms/_utils/backingCampaign';
import { createAdminClient, getSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FARM_ADDRESS_LIMIT = 5000;

type GenerateFarmAddressListRequest = {
  farm_id: string;
  polygon?: {
    type: 'Polygon';
    coordinates: number[][][];
  };
};

export async function POST(request: NextRequest) {
  try {
    const authClient = await getSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as GenerateFarmAddressListRequest;
    const farmId = body.farm_id?.trim();
    if (!farmId) {
      return NextResponse.json({ error: 'farm_id is required' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { farm, hasLinkedCampaignColumn } = await selectFarmCampaignRow(admin, farmId);
    if (!farm) {
      return NextResponse.json({ error: 'Farm not found' }, { status: 404 });
    }

    const canAccess = await userCanAccessFarm(admin, user.id, farm);
    if (!canAccess) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const linkedCampaignId = await resolveBackingCampaignId(admin, farm, hasLinkedCampaignColumn);
    if (!linkedCampaignId) {
      return NextResponse.json({ error: 'Farm has no linked campaign' }, { status: 400 });
    }

    const forwardedHeaders: HeadersInit = {
      'Content-Type': 'application/json',
    };
    const cookie = request.headers.get('cookie');
    const authorization = request.headers.get('authorization');
    if (cookie) {
      forwardedHeaders['cookie'] = cookie;
    }
    if (authorization) {
      forwardedHeaders['authorization'] = authorization;
    }

    const addressResponse = await fetch(new URL('/api/campaigns/generate-address-list', request.nextUrl.origin), {
      method: 'POST',
      headers: forwardedHeaders,
      body: JSON.stringify({
        campaign_id: linkedCampaignId,
        polygon: body.polygon,
        address_limit: Math.min(
          FARM_ADDRESS_LIMIT,
          Math.max(1, Number(farm.home_limit ?? FARM_ADDRESS_LIMIT) || FARM_ADDRESS_LIMIT)
        ),
      }),
      cache: 'no-store',
    });

    const addressResult = await addressResponse.json().catch(() => ({}));
    if (!addressResponse.ok) {
      return NextResponse.json(
        { error: addressResult.error || `Failed to generate farm homes (${addressResponse.status})` },
        { status: addressResponse.status }
      );
    }

    const syncResponse = await fetch(new URL(`/api/farms/${farm.id}/sync-addresses`, request.nextUrl.origin), {
      method: 'POST',
      headers: forwardedHeaders,
      cache: 'no-store',
    });
    const syncResult = await syncResponse.json().catch(() => ({}));
    if (!syncResponse.ok) {
      return NextResponse.json(
        { error: syncResult.error || `Failed to sync farm homes (${syncResponse.status})` },
        { status: syncResponse.status }
      );
    }

    return NextResponse.json({
      farm_id: farm.id,
      linked_campaign_id: linkedCampaignId,
      inserted_count: syncResult.inserted_count ?? addressResult.inserted_count ?? 0,
      campaign_inserted_count: addressResult.inserted_count ?? 0,
      warning: addressResult.warning,
    });
  } catch (error) {
    console.error('[farm generate-address-list]', error);
    return NextResponse.json(
      { error: formatApiError(error) },
      { status: 500 }
    );
  }
}
