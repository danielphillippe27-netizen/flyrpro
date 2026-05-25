import { createAdminClient } from '@/lib/supabase/server';

type AdminClient = ReturnType<typeof createAdminClient>;

type DeleteCampaignAddressOptions = {
  requireManualSource?: boolean;
};

type DeleteCampaignAddressResult = {
  found: boolean;
  addressId: string;
  rejectedReason?: 'not_manual';
};

export function uniqueNonEmpty(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]));
}

async function ensureMutation(label: string, mutation: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await mutation;
  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

async function deleteAddressDependents(
  admin: AdminClient,
  campaignId: string,
  addressId: string
) {
  // Delete strict child rows first, then null optional references that should
  // survive without a campaign address.
  await ensureMutation(
    'Failed to delete address statuses',
    admin
      .from('address_statuses')
      .delete()
      .eq('campaign_id', campaignId)
      .eq('campaign_address_id', addressId)
  );
  await ensureMutation(
    'Failed to delete campaign home events',
    admin
      .from('campaign_home_events')
      .delete()
      .eq('campaign_id', campaignId)
      .eq('campaign_address_id', addressId)
  );
  await ensureMutation(
    'Failed to delete building address links',
    admin
      .from('building_address_links')
      .delete()
      .eq('campaign_id', campaignId)
      .eq('address_id', addressId)
  );
  await ensureMutation(
    'Failed to delete address content',
    admin
      .from('address_content')
      .delete()
      .eq('address_id', addressId)
  );
  await ensureMutation(
    'Failed to delete address orphan records',
    admin
      .from('address_orphans')
      .delete()
      .eq('campaign_id', campaignId)
      .eq('address_id', addressId)
  );
  await ensureMutation(
    'Failed to delete building slices',
    admin
      .from('building_slices')
      .delete()
      .eq('campaign_id', campaignId)
      .eq('address_id', addressId)
  );
  await ensureMutation(
    'Failed to delete building touches',
    admin
      .from('building_touches')
      .delete()
      .eq('campaign_id', campaignId)
      .eq('address_id', addressId)
  );
  await ensureMutation(
    'Failed to delete building units',
    admin
      .from('building_units')
      .delete()
      .eq('campaign_id', campaignId)
      .eq('address_id', addressId)
  );
  await ensureMutation(
    'Failed to delete campaign assignment homes',
    admin
      .from('campaign_assignment_homes')
      .delete()
      .eq('campaign_address_id', addressId)
  );
  await ensureMutation(
    'Failed to delete session events',
    admin
      .from('session_events')
      .delete()
      .eq('address_id', addressId)
  );

  await ensureMutation(
    'Failed to unlink contacts',
    admin
      .from('contacts')
      .update({ address_id: null })
      .eq('campaign_id', campaignId)
      .eq('address_id', addressId)
  );
  await ensureMutation(
    'Failed to unlink landing pages',
    admin
      .from('landing_pages')
      .update({ address_id: null })
      .eq('campaign_id', campaignId)
      .eq('address_id', addressId)
  );
  await ensureMutation(
    'Failed to unlink QR codes',
    admin
      .from('qr_codes')
      .update({ address_id: null })
      .eq('campaign_id', campaignId)
      .eq('address_id', addressId)
  );
  await ensureMutation(
    'Failed to unlink QR code scans',
    admin
      .from('qr_code_scans')
      .update({ address_id: null })
      .eq('address_id', addressId)
  );
  await ensureMutation(
    'Failed to unlink scan events',
    admin
      .from('scan_events')
      .update({ address_id: null })
      .eq('campaign_id', campaignId)
      .eq('address_id', addressId)
  );
  await ensureMutation(
    'Failed to unlink route stops',
    admin
      .from('route_stops')
      .update({ address_id: null })
      .eq('address_id', addressId)
  );
  await ensureMutation(
    'Failed to unlink buildings',
    admin
      .from('buildings')
      .update({ address_id: null })
      .eq('campaign_id', campaignId)
      .eq('address_id', addressId)
  );
  await ensureMutation(
    'Failed to unlink map buildings',
    admin
      .from('map_buildings')
      .update({ address_id: null })
      .eq('campaign_id', campaignId)
      .eq('address_id', addressId)
  );
}

export async function deleteCampaignAddressDeep(
  admin: AdminClient,
  campaignId: string,
  addressId: string,
  options: DeleteCampaignAddressOptions = {}
): Promise<DeleteCampaignAddressResult> {
  const { data: address, error: addressError } = await admin
    .from('campaign_addresses')
    .select('id, source')
    .eq('campaign_id', campaignId)
    .eq('id', addressId)
    .maybeSingle();

  if (addressError) {
    throw new Error(addressError.message);
  }

  if (!address) {
    return { found: false, addressId };
  }

  if (options.requireManualSource && (address as { source?: string | null }).source !== 'manual') {
    return { found: true, addressId, rejectedReason: 'not_manual' };
  }

  await deleteAddressDependents(admin, campaignId, addressId);

  await ensureMutation(
    'Failed to delete campaign address',
    admin
      .from('campaign_addresses')
      .delete()
      .eq('campaign_id', campaignId)
      .eq('id', addressId)
  );

  return { found: true, addressId };
}

export async function resolveBuildingRow(
  admin: AdminClient,
  campaignId: string,
  buildingIdParam: string
) {
  const uuidMatch = buildingIdParam.match(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  );

  const query = admin
    .from('buildings')
    .select('id, gers_id, source')
    .eq('campaign_id', campaignId)
    .limit(1);

  const builder = uuidMatch
    ? query.or(`id.eq.${buildingIdParam},gers_id.eq.${buildingIdParam}`)
    : query.eq('gers_id', buildingIdParam);

  const { data, error } = await builder.maybeSingle();
  if (error || !data) {
    return null;
  }

  return data as { id: string; gers_id: string | null; source: string | null };
}

export async function deleteBuildingDeep(
  admin: AdminClient,
  campaignId: string,
  buildingId: string
) {
  const row = await resolveBuildingRow(admin, campaignId, buildingId);
  let addressBackedBuildingId: string | null = null;
  let addressBackedPublicBuildingId: string | null = null;
  let directAddressId: string | null = null;

  if (!row) {
    const { data: addressRow, error: addressError } = await admin
      .from('campaign_addresses')
      .select('id, building_id, building_gers_id')
      .eq('campaign_id', campaignId)
      .eq('id', buildingId)
      .maybeSingle();

    if (addressError) {
      throw new Error(addressError.message);
    }

    if (addressRow) {
      const address = addressRow as {
        id: string;
        building_id?: string | null;
        building_gers_id?: string | null;
      };
      directAddressId = address.id;
      addressBackedBuildingId = address.building_id ?? null;
      addressBackedPublicBuildingId = address.building_gers_id ?? address.building_id ?? null;
    }
  }

  const publicBuildingId = row?.gers_id ?? row?.id ?? addressBackedPublicBuildingId ?? buildingId.trim();
  const buildingIdentifiers = uniqueNonEmpty([row?.id, row?.gers_id, addressBackedBuildingId, addressBackedPublicBuildingId, buildingId]);

  let linkedAddressIds: string[] = [];
  if (directAddressId) {
    linkedAddressIds.push(directAddressId);
  }

  if (buildingIdentifiers.length > 0) {
    const { data: linkRows, error: linkQueryError } = await admin
      .from('building_address_links')
      .select('address_id')
      .eq('campaign_id', campaignId)
      .in('building_id', buildingIdentifiers);

    if (linkQueryError) {
      throw new Error(linkQueryError.message);
    }

    linkedAddressIds.push(
      ...(linkRows || [])
        .map((entry: { address_id?: string | null }) => entry.address_id)
        .filter((value): value is string => Boolean(value))
    );

    const { data: directBuildingAddresses, error: directBuildingAddressesError } = await admin
      .from('campaign_addresses')
      .select('id')
      .eq('campaign_id', campaignId)
      .in('building_id', buildingIdentifiers);

    if (directBuildingAddressesError) {
      throw new Error(directBuildingAddressesError.message);
    }

    linkedAddressIds.push(
      ...(directBuildingAddresses || [])
        .map((entry: { id?: string | null }) => entry.id)
        .filter((value): value is string => Boolean(value))
    );
  }

  if (publicBuildingId) {
    const { data: gersAddresses, error: gersAddressesError } = await admin
      .from('campaign_addresses')
      .select('id')
      .eq('campaign_id', campaignId)
      .eq('building_gers_id', publicBuildingId);

    if (gersAddressesError) {
      throw new Error(gersAddressesError.message);
    }

    linkedAddressIds.push(
      ...(gersAddresses || [])
        .map((entry: { id?: string | null }) => entry.id)
        .filter((value): value is string => Boolean(value))
    );

    const { error: hiddenBuildingError } = await admin
      .from('campaign_hidden_buildings')
      .upsert({
        campaign_id: campaignId,
        public_building_id: publicBuildingId,
      });

    if (hiddenBuildingError) {
      console.warn('[location-delete] Hidden building upsert skipped:', hiddenBuildingError);
    }
  }

  linkedAddressIds = uniqueNonEmpty(linkedAddressIds);

  if (!row && linkedAddressIds.length === 0) {
    return {
      found: false,
      buildingId: publicBuildingId,
      deletedAddressIds: [] as string[],
      deletedBuildingRow: false,
    };
  }

  for (const linkedAddressId of linkedAddressIds) {
    await deleteCampaignAddressDeep(admin, campaignId, linkedAddressId);
  }

  if (buildingIdentifiers.length > 0) {
    const { error: linkDeleteError } = await admin
      .from('building_address_links')
      .delete()
      .eq('campaign_id', campaignId)
      .in('building_id', buildingIdentifiers);

    if (linkDeleteError) {
      throw new Error(linkDeleteError.message);
    }
  }

  if (publicBuildingId) {
    const { error: statsDeleteError } = await admin
      .from('building_stats')
      .delete()
      .eq('campaign_id', campaignId)
      .eq('gers_id', publicBuildingId);

    if (statsDeleteError) {
      console.warn('[location-delete] Building stats delete warning:', statsDeleteError);
    }

    const { error: unitsDeleteError } = await admin
      .from('building_units')
      .delete()
      .eq('campaign_id', campaignId)
      .eq('parent_building_id', publicBuildingId);

    if (unitsDeleteError) {
      console.warn('[location-delete] Building units delete warning:', unitsDeleteError);
    }
  }

  if (row) {
    const { error: deleteError } = await admin
      .from('buildings')
      .delete()
      .eq('campaign_id', campaignId)
      .eq('id', row.id);

    if (deleteError) {
      throw new Error(deleteError.message);
    }
  }

  return {
    found: true,
    buildingId: publicBuildingId,
    deletedAddressIds: linkedAddressIds,
    deletedBuildingRow: Boolean(row),
  };
}

export async function deleteAddressIfExists(
  admin: AdminClient,
  campaignId: string,
  addressId: string
) {
  return deleteCampaignAddressDeep(admin, campaignId, addressId);
}

export async function deleteParcelIfExists(
  admin: AdminClient,
  campaignId: string,
  parcelId: string
) {
  const { data: parcel, error: parcelError } = await admin
    .from('campaign_parcels')
    .select('id')
    .eq('campaign_id', campaignId)
    .eq('id', parcelId)
    .maybeSingle();

  if (parcelError) {
    throw new Error(parcelError.message);
  }

  if (!parcel) {
    return { found: false, parcelId };
  }

  const { error: deleteError } = await admin
    .from('campaign_parcels')
    .delete()
    .eq('campaign_id', campaignId)
    .eq('id', parcelId);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  return { found: true, parcelId };
}
