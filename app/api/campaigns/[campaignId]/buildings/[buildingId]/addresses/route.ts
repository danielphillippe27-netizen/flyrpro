import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { compareAddressesForDisplay, displayAddressText, resolveHouseNumberLabel } from '@/lib/map/addressPresentation';
import { StableLinkerService } from '@/lib/services/StableLinkerService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AddressResult {
  address_id: string;
  formatted: string;
  house_number: string | null;
  street_name: string | null;
  unit_number: string | null;
  visited?: boolean | null;
  address_status?: string | null;
  match_type: string;
  confidence: number;
  distance_meters: number;
  is_outside_footprint: boolean;
  geom: {
    type: 'Point';
    coordinates: [number, number];
  };
}

type BuildingLinkRow = {
  address_id: string;
  match_type: string;
  confidence: number;
  distance_meters: number;
  campaign_addresses: {
    id: string;
    formatted: string;
    house_number: string | null;
    street_name: string | null;
    geom: AddressResult['geom'];
  };
};

type BuildingLinkSelectRow = Omit<BuildingLinkRow, 'campaign_addresses'> & {
  campaign_addresses: BuildingLinkRow['campaign_addresses'] | BuildingLinkRow['campaign_addresses'][] | null;
};

type GoldAddressRow = {
  id: string;
  formatted: string;
  house_number: string | null;
  street_name: string | null;
  geom: AddressResult['geom'];
  match_source: string | null;
  confidence: number | null;
};

type AuthorizedContext = {
  supabase: ReturnType<typeof createAdminClient>;
  userId: string;
};

type ResolvedBuilding = {
  rowId: string | null;
  publicId: string;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function resolveBuilding(
  supabase: ReturnType<typeof createAdminClient>,
  campaignId: string,
  buildingIdParam: string
): Promise<ResolvedBuilding | null> {
  const buildingQuery = supabase
    .from('buildings')
    .select('id, gers_id')
    .eq('campaign_id', campaignId)
    .limit(1);

  const { data: row, error } = isUuid(buildingIdParam)
    ? await buildingQuery.or(`id.eq.${buildingIdParam},gers_id.eq.${buildingIdParam}`).maybeSingle()
    : await buildingQuery.eq('gers_id', buildingIdParam).maybeSingle();

  if (!error && row) {
    return {
      rowId: row.id,
      publicId: row.gers_id ?? row.id,
    };
  }

  if (!isUuid(buildingIdParam)) return null;
  const { data: goldRow } = await supabase
    .from('ref_buildings_gold')
    .select('id')
    .eq('id', buildingIdParam)
    .maybeSingle();

  return goldRow ? { rowId: null, publicId: String(goldRow.id) } : null;
}

function chooseLinksForDisplay(links: BuildingLinkRow[]): BuildingLinkRow[] {
  if (links.length <= 1) return links;

  const provenLinks = links.filter((link) => {
    const matchType = (link.match_type ?? '').toLowerCase();
    if (matchType === 'manual') return true;
    if (matchType === 'containment_verified') return true;
    if (matchType === 'point_on_surface') return true;
    if (matchType === 'parcel_verified') return true;
    return false;
  });

  if (provenLinks.length > 0) {
    return provenLinks;
  }

  const proximityVerifiedLinks = links.filter((link) => {
    const matchType = (link.match_type ?? '').toLowerCase();
    return matchType === 'proximity_verified' && (link.confidence ?? 0) >= 0.75;
  });
  if (proximityVerifiedLinks.length > 0) {
    return [pickBestLink(proximityVerifiedLinks)];
  }

  const fallbackLinks = links.filter((link) => (link.match_type ?? '').toLowerCase() === 'proximity_fallback');
  if (fallbackLinks.length > 0) {
    return [pickBestLink(fallbackLinks)];
  }

  return links;
}

function pickBestLink(links: BuildingLinkRow[]): BuildingLinkRow {
  return [...links].sort((a, b) => {
    const distanceA = a.distance_meters ?? Number.POSITIVE_INFINITY;
    const distanceB = b.distance_meters ?? Number.POSITIVE_INFINITY;
    if (distanceA !== distanceB) return distanceA - distanceB;
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  })[0];
}

function normalizeBuildingLinks(rows: BuildingLinkSelectRow[]): BuildingLinkRow[] {
  return rows.flatMap((row) => {
    const address = Array.isArray(row.campaign_addresses)
      ? row.campaign_addresses[0]
      : row.campaign_addresses;

    if (!address) return [];

    return [
      {
        address_id: row.address_id,
        match_type: row.match_type,
        confidence: row.confidence,
        distance_meters: row.distance_meters,
        campaign_addresses: address,
      },
    ];
  });
}

async function resolveAuthorizedContext(
  request: NextRequest,
  campaignId: string
): Promise<{ context?: AuthorizedContext; error?: NextResponse }> {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const supabase = createAdminClient();
  const { data: campaign, error: campaignError } = await supabase
    .from('campaigns')
    .select('owner_id, workspace_id')
    .eq('id', campaignId)
    .maybeSingle();

  if (campaignError || !campaign) {
    return { error: NextResponse.json({ error: 'Campaign not found' }, { status: 404 }) };
  }

  let allowed = campaign.owner_id === requestUser.id;
  if (!allowed && campaign.workspace_id) {
    const { data: member } = await supabase
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', campaign.workspace_id)
      .eq('user_id', requestUser.id)
      .maybeSingle();
    allowed = !!member?.user_id;
  }

  if (!allowed) {
    return { error: NextResponse.json({ error: 'Access denied' }, { status: 403 }) };
  }

  return {
    context: {
      supabase,
      userId: requestUser.id,
    },
  };
}

/**
 * GET /api/campaigns/[campaignId]/buildings/[buildingId]/addresses
 * 
 * Returns all addresses linked to a specific building.
 * Includes flags for addresses outside the building footprint.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string; buildingId: string }> }
) {
  const { campaignId, buildingId } = await params;
  
  console.log(`[API] GET /campaigns/${campaignId}/buildings/${buildingId}/addresses`);
  
  try {
    const auth = await resolveAuthorizedContext(request, campaignId);
    if (auth.error) return auth.error;
    const { supabase } = auth.context!;
    
    // Get threshold for "outside footprint" warning
    const outsideThreshold = parseFloat(process.env.ADDRESS_OUTSIDE_THRESHOLD_METERS || '10');
    const candidateBuildingIds = new Set([buildingId]);

    try {
      const buildingQuery = supabase
        .from('buildings')
        .select('id, gers_id')
        .eq('campaign_id', campaignId);

      const { data: buildingRows, error: buildingLookupError } = isUuid(buildingId)
        ? await buildingQuery.or(`id.eq.${buildingId},gers_id.eq.${buildingId}`)
        : await buildingQuery.eq('gers_id', buildingId);

      if (buildingLookupError) {
        console.warn('[API] Building identifier expansion failed:', buildingLookupError.message);
      } else {
        for (const row of buildingRows ?? []) {
          if (typeof row.id === 'string' && row.id.length > 0) candidateBuildingIds.add(row.id);
          if (typeof row.gers_id === 'string' && row.gers_id.length > 0) candidateBuildingIds.add(row.gers_id);
        }
      }
    } catch (lookupError) {
      console.warn('[API] Building identifier expansion threw:', lookupError);
    }

    const candidateBuildingIdList = Array.from(candidateBuildingIds);
    const uuidCandidateBuildingIds = candidateBuildingIdList.filter(isUuid);
    const goldAddressSelect = 'id, formatted, house_number, street_name, geom, match_source, confidence';
    
    // Fetch addresses linked to this building.
    // Gold assignments live on campaign_addresses.building_id and are the source
    // of truth when present. Bedrock/NZ and other external datasets can address
    // buildings by public LINZ/GERS ids, so keep those out of UUID-typed
    // building_id queries and look them up through building_gers_id instead.
    let addresses: AddressResult[] = [];
    const goldAddressById = new Map<string, GoldAddressRow>();

    if (uuidCandidateBuildingIds.length > 0) {
      const { data: uuidGoldAddresses, error: uuidGoldError } = await supabase
        .from('campaign_addresses')
        .select(goldAddressSelect)
        .eq('campaign_id', campaignId)
        .in('building_id', uuidCandidateBuildingIds);

      if (uuidGoldError) {
        console.warn('[API] Error fetching Gold addresses by UUID building_id:', uuidGoldError.message);
      } else {
        for (const addr of (uuidGoldAddresses || []) as GoldAddressRow[]) {
          goldAddressById.set(addr.id, addr);
        }
      }
    }

    const { data: gersGoldAddresses, error: gersGoldError } = await supabase
      .from('campaign_addresses')
      .select(goldAddressSelect)
      .eq('campaign_id', campaignId)
      .in('building_gers_id', candidateBuildingIdList);

    if (gersGoldError) {
      console.warn('[API] Error fetching Gold addresses by building_gers_id:', gersGoldError.message);
    } else {
      for (const addr of (gersGoldAddresses || []) as GoldAddressRow[]) {
        goldAddressById.set(addr.id, addr);
      }
    }

    const goldAddresses = Array.from(goldAddressById.values());

    if (goldAddresses.length > 0) {
      addresses = goldAddresses.map((addr) => ({
        address_id: addr.id,
        formatted: displayAddressText(addr) ?? '',
        house_number: resolveHouseNumberLabel(addr),
        street_name: addr.street_name,
        unit_number: null,
        match_type: addr.match_source || 'gold_exact',
        confidence: addr.confidence || 1.0,
        distance_meters: 0, // Gold links are spatially exact
        is_outside_footprint: false,
        geom: addr.geom,
      }));
    } else {
      const { data: links, error: linksError } = await supabase
        .from('building_address_links')
        .select(`
          address_id,
          match_type,
          confidence,
          distance_meters,
          campaign_addresses:campaign_addresses!inner (
            id,
            formatted,
            house_number,
            street_name,
            geom
          )
        `)
        .eq('campaign_id', campaignId)
        .in('building_id', candidateBuildingIdList)
        .order('confidence', { ascending: false });

      if (linksError) {
        console.warn('[API] Error fetching from links table:', linksError.message);
      }

      addresses = chooseLinksForDisplay(normalizeBuildingLinks((links || []) as unknown as BuildingLinkSelectRow[])).map((link) => ({
        address_id: link.address_id,
        formatted: displayAddressText(link.campaign_addresses) ?? '',
        house_number: resolveHouseNumberLabel(link.campaign_addresses),
        street_name: link.campaign_addresses.street_name,
        unit_number: null,
        match_type: link.match_type,
        confidence: link.confidence,
        distance_meters: link.distance_meters,
        is_outside_footprint: link.distance_meters > outsideThreshold,
        geom: link.campaign_addresses.geom,
      }));
    }

    if (addresses.length > 0) {
      const { data: canonicalStates } = await supabase
        .from('campaign_addresses_geojson')
        .select('id, visited, address_status')
        .in('id', addresses.map((address) => address.address_id));

      const stateById = new Map(
        (canonicalStates || []).map((row) => [
          row.id as string,
          {
            visited: (row as { visited?: boolean | null }).visited ?? null,
            address_status: (row as { address_status?: string | null }).address_status ?? null,
          },
        ])
      );

      addresses = addresses.map((address) => ({
        ...address,
        visited: stateById.get(address.address_id)?.visited ?? null,
        address_status: stateById.get(address.address_id)?.address_status ?? null,
      }));
    }

    addresses.sort((left, right) =>
      compareAddressesForDisplay(
        {
          house_number: left.house_number,
          street_name: left.street_name,
          formatted: left.formatted,
        },
        {
          house_number: right.house_number,
          street_name: right.street_name,
          formatted: right.formatted,
        }
      )
    );
    
    // Calculate summary
    const outsideCount = addresses.filter(a => a.is_outside_footprint).length;
    
    return NextResponse.json({
      success: true,
      building_id: buildingId,
      campaign_id: campaignId,
      addresses,
      summary: {
        total: addresses.length,
        outside_footprint: outsideCount,
        inside_footprint: addresses.length - outsideCount,
      },
    });
    
  } catch (error) {
    console.error('[API] Error fetching building addresses:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch addresses' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/campaigns/[campaignId]/buildings/[buildingId]/addresses
 * 
 * Manually link an address to a building.
 * Body: { address_id: string, unit_label?: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string; buildingId: string }> }
) {
  const { campaignId, buildingId } = await params;
  
  console.log(`[API] POST /campaigns/${campaignId}/buildings/${buildingId}/addresses`);
  
  try {
    const auth = await resolveAuthorizedContext(request, campaignId);
    if (auth.error) return auth.error;
    const { supabase, userId } = auth.context!;
    
    const body = await request.json();
    const { address_id, unit_label } = body;
    
    if (!address_id) {
      return NextResponse.json(
        { error: 'address_id is required' },
        { status: 400 }
      );
    }
    
    const resolvedBuilding = await resolveBuilding(supabase, campaignId, buildingId);
    if (!resolvedBuilding) {
      return NextResponse.json({ error: 'Building not found' }, { status: 404 });
    }

    const longitude = typeof body.longitude === 'number' && Number.isFinite(body.longitude)
      ? body.longitude
      : null;
    const latitude = typeof body.latitude === 'number' && Number.isFinite(body.latitude)
      ? body.latitude
      : null;
    const coordinate = longitude !== null && latitude !== null
      ? [longitude, latitude] as [number, number]
      : undefined;

    const linker = new StableLinkerService(supabase);
    const stableLink = resolvedBuilding.rowId
      ? await linker.assignAddressToBuilding({
          campaignId,
          addressId: address_id,
          buildingRowId: resolvedBuilding.rowId,
          buildingPublicId: resolvedBuilding.publicId,
          coordinate,
          assignedBy: userId,
        })
      : await linker.assignAddressToGoldBuilding({
          campaignId,
          addressId: address_id,
          buildingPublicId: resolvedBuilding.publicId,
          coordinate,
          assignedBy: userId,
        });
    
    return NextResponse.json({
      success: true,
      message: 'Address linked successfully',
      building_id: resolvedBuilding.publicId,
      address_id,
      linked_address_ids: stableLink.linkedAddressIds,
      unit_count: stableLink.unitCount,
      unit_label: unit_label || null,
    });
    
  } catch (error) {
    console.error('[API] Error linking address:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to link address' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/campaigns/[campaignId]/buildings/[buildingId]/addresses
 * 
 * Unlink an address from a building.
 * Query param: address_id
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string; buildingId: string }> }
) {
  const { campaignId, buildingId } = await params;
  
  console.log(`[API] DELETE /campaigns/${campaignId}/buildings/${buildingId}/addresses`);
  
  try {
    const auth = await resolveAuthorizedContext(request, campaignId);
    if (auth.error) return auth.error;
    const { supabase } = auth.context!;
    
    // Get address_id from query params
    const { searchParams } = new URL(request.url);
    const address_id = searchParams.get('address_id');
    
    if (!address_id) {
      return NextResponse.json(
        { error: 'address_id query parameter is required' },
        { status: 400 }
      );
    }
    
    // Delete the link
    const { error: deleteError } = await supabase
      .from('building_address_links')
      .delete()
      .eq('campaign_id', campaignId)
      .eq('building_id', buildingId)
      .eq('address_id', address_id);
    
    if (deleteError) {
      throw new Error(`Failed to unlink address: ${deleteError.message}`);
    }
    
    return NextResponse.json({
      success: true,
      message: 'Address unlinked successfully',
      building_id: buildingId,
      address_id,
    });
    
  } catch (error) {
    console.error('[API] Error unlinking address:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to unlink address' },
      { status: 500 }
    );
  }
}
