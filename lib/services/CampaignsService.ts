import { createClient } from '@/lib/supabase/client';
import type { CampaignV2, CampaignAddress, CampaignContact, QRCode } from '@/types/database';
import type { CreateCampaignPayload } from '@/types/campaigns';
import { QRCodeService } from '@/lib/services/QRCodeService';
import type { QRCodeWithScanStatus } from '@/lib/services/QRCodeService';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Helper to format Supabase/Postgres errors for logging
 * Supabase errors don't serialize well with console.error alone
 */
function formatError(error: unknown): string {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  // Supabase PostgrestError has code, message, details, hint properties
  const e = error as { code?: string; message?: string; details?: string; hint?: string };
  const parts = [];
  if (e.code) parts.push(`code=${e.code}`);
  if (e.message) parts.push(e.message);
  if (e.details) parts.push(`details=${e.details}`);
  if (e.hint) parts.push(`hint=${e.hint}`);
  return parts.length > 0 ? parts.join(', ') : JSON.stringify(error);
}

export class CampaignsService {
  private static client = createClient();

  private static mapBaseAddressRows(rows: Array<Record<string, unknown>>): CampaignAddress[] {
    return rows.map((row) => {
      const statusJoin = row.address_statuses;
      const addressStatus = Array.isArray(statusJoin)
        ? statusJoin[0]?.status
        : statusJoin?.status;

      const geomJson =
        row.geom && typeof row.geom === 'object'
          ? row.geom
          : undefined;

      return {
        ...row,
        address: row.formatted || '',
        geom_json: geomJson,
        gers_id: row.gers_id ?? row.source_id ?? null,
        address_status: addressStatus ?? 'none',
      } as CampaignAddress;
    });
  }

  private static async fetchAddressesFromBaseTable(campaignId: string): Promise<CampaignAddress[]> {
    const { data, error } = await this.client
      .from('campaign_addresses')
      .select(`
        id,
        campaign_id,
        gers_id,
        formatted,
        postal_code,
        source,
        source_id,
        seq,
        visited,
        coordinate,
        geom,
        building_outline,
        road_bearing,
        house_bearing,
        street_name,
        house_number,
        is_oriented,
        orientation_locked,
        locality,
        region,
        scans,
        last_scanned_at,
        qr_code_base64,
        purl,
        created_at,
        cluster_id,
        sequence,
        walk_time_sec,
        distance_m,
        address_statuses(status)
      `)
      .eq('campaign_id', campaignId)
      .order('seq', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true });

    if (error) {
      console.error('Fallback address query failed:', formatError(error));
      return [];
    }

    return this.mapBaseAddressRows((data || []) as Array<Record<string, unknown>>);
  }

  static async fetchCampaignsV2(_userId: string, workspaceId?: string | null): Promise<CampaignV2[]> {
    const qs = new URLSearchParams();
    if (workspaceId) {
      qs.set('workspaceId', workspaceId);
    }

    const res = await fetch(`/api/campaigns${qs.toString() ? `?${qs.toString()}` : ''}`, {
      credentials: 'include',
    });
    if (!res.ok) {
      throw new Error(`Failed to load campaigns (${res.status})`);
    }

    const data = (await res.json()) as CampaignV2[];

    // Compute progress for each campaign
    return (data || []).map((campaign) => {
      const totalFlyers = campaign.total_flyers || 0;
      const scans = campaign.scans || 0;
      const progress = totalFlyers > 0 ? scans / totalFlyers : 0;
      const progressPct = Math.round(progress * 100);

      return {
        ...campaign,
        // Map title to name if title exists (for backward compatibility)
        name: campaign.title || campaign.name || 'Unnamed Campaign',
        // Provide default type if missing
        type: campaign.type || 'flyer',
        progress,
        progress_pct: progressPct,
      } as CampaignV2;
    });
  }

  static async fetchCampaign(id: string): Promise<CampaignV2 | null> {
    const { data, error } = await this.client
      .from('campaigns')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error('Error fetching campaign:', {
        id,
        error: error.message,
        code: error.code,
        details: error.details,
        hint: error.hint,
      });
      throw error;
    }
    
    if (!data) {
      console.warn('Campaign not found:', id);
      return null;
    }

    // Permission guard: workspace members with role=member can only access their own campaigns.
    const workspaceId = (data.workspace_id as string | null) ?? null;
    const ownerId = (data.owner_id || data.user_id || '') as string;
    if (workspaceId) {
      const { data: authData } = await this.client.auth.getUser();
      const currentUserId = authData.user?.id ?? null;
      if (!currentUserId) return null;

      const { data: membership } = await this.client
        .from('workspace_members')
        .select('role')
        .eq('workspace_id', workspaceId)
        .eq('user_id', currentUserId)
        .maybeSingle();

      if (!membership?.role) return null;
      if (membership.role === 'member' && ownerId !== currentUserId) {
        return null;
      }
    }

    const totalFlyers = data.total_flyers || 0;
    const scans = data.scans || 0;
    const progress = totalFlyers > 0 ? scans / totalFlyers : 0;
    const progressPct = Math.round(progress * 100);

    return {
      ...data,
      // Map user_id to owner_id if needed for compatibility (database may have either)
      owner_id: data.owner_id || data.user_id || '',
      // Map title to name if title exists (for backward compatibility)
      name: data.title || data.name || 'Unnamed Campaign',
      // Provide default type if missing
      type: data.type || 'flyer',
      progress,
      progress_pct: progressPct,
    } as CampaignV2;
  }

  static async createV2(userId: string, payload: CreateCampaignPayload, workspaceId?: string | null): Promise<CampaignV2> {
    const { data, error } = await this.client
      .from('campaigns')
      .insert({
        owner_id: userId,
        workspace_id: workspaceId ?? undefined,
        name: payload.name,
        title: payload.name, // Set title to match name for database constraint
        description: '', // Set empty description to satisfy NOT NULL constraint
        type: payload.type,
        address_source: payload.address_source,
        seed_query: payload.seed_query,
        bbox: payload.bbox, // Bounding box: [min_lon, min_lat, max_lon, max_lat]
        territory_boundary: payload.territory_boundary, // User's drawn polygon for surgical filtering
        total_flyers: 0,
        scans: 0,
        conversions: 0,
        status: 'draft',
      })
      .select()
      .single();

    if (error) throw error;

    // If addresses provided, bulk add them
    if (payload.addresses && payload.addresses.length > 0) {
      await this.bulkAddAddresses(data.id, payload.addresses);
    }

    return {
      ...data,
      progress: 0,
      progress_pct: 0,
    } as CampaignV2;
  }

  static async fetchAddresses(campaignId: string): Promise<CampaignAddress[]> {
    try {
      const { data, error } = await this.client
        .from('campaign_addresses_geojson')
        .select('*, qr_code_base64')  // Explicitly include qr_code_base64
        .eq('campaign_id', campaignId)
        .order('seq', { ascending: true, nullsFirst: false })
        .order('id', { ascending: true });

      if (error) {
        console.error('Error fetching campaign addresses:', formatError(error));
        // Fall back to base table when the view is missing/out-of-sync.
        if (error.code === 'PGRST205' || error.message?.includes('schema cache')) {
          console.warn('campaign_addresses_geojson view not found, falling back to campaign_addresses');
          return await this.fetchAddressesFromBaseTable(campaignId);
        }
        return await this.fetchAddressesFromBaseTable(campaignId);
      }

      const rows = (data || []) as unknown as CampaignAddress[];
      if (rows.length > 0) {
        return rows;
      }

      // If the view returns empty, verify against base table once.
      const fallbackRows = await this.fetchAddressesFromBaseTable(campaignId);
      if (fallbackRows.length > 0) {
        console.warn(
          `campaign_addresses_geojson returned 0 rows for campaign ${campaignId}, using base table fallback (${fallbackRows.length})`
        );
        return fallbackRows;
      }

      return rows;
    } catch (error) {
      console.error('Error fetching addresses, returning empty array:', formatError(error));
      return await this.fetchAddressesFromBaseTable(campaignId);
    }
  }

  static async fetchCampaignContacts(campaignId: string): Promise<CampaignContact[]> {
    const { data, error } = await this.client
      .from('campaign_contacts')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('updated_at', { ascending: false });

    if (error) {
      console.warn('fetchCampaignContacts:', formatError(error));
      return [];
    }
    return (data || []) as CampaignContact[];
  }

  static async createCampaignContact(
    campaignId: string,
    contact: Omit<CampaignContact, 'id' | 'campaign_id' | 'created_at' | 'updated_at'>
  ): Promise<CampaignContact> {
    const { data, error } = await this.client
      .from('campaign_contacts')
      .insert({
        campaign_id: campaignId,
        name: contact.name ?? null,
        phone: contact.phone ?? null,
        email: contact.email ?? null,
        address: contact.address ?? null,
        address_id: contact.address_id ?? null,
        last_contacted_at: contact.last_contacted_at ?? null,
        interest_level: contact.interest_level ?? null,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    return data as CampaignContact;
  }

  static async updateCampaignContact(
    id: string,
    updates: Partial<Pick<CampaignContact, 'name' | 'phone' | 'email' | 'address' | 'last_contacted_at' | 'interest_level' | 'address_id'>>
  ): Promise<void> {
    const { error } = await this.client
      .from('campaign_contacts')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;
  }

  static async deleteCampaignContact(id: string): Promise<void> {
    const { error } = await this.client.from('campaign_contacts').delete().eq('id', id);
    if (error) throw error;
  }

  /**
   * @deprecated This method is deprecated. Use fetchAddresses() instead.
   * CSV uploads now go directly to campaign_addresses table.
   * This method is kept for backward compatibility but always returns an empty array.
   */
  static async fetchRecipients(_campaignId: string): Promise<unknown[]> {
    void _campaignId;
    console.warn('fetchRecipients() is deprecated. Use fetchAddresses() instead.');
    return [];
  }

  static async bulkAddAddresses(
    campaignId: string,
    addresses: Omit<CampaignAddress, 'id' | 'campaign_id' | 'created_at'>[]
  ): Promise<void> {
    const addressesToInsert = addresses.map((addr) => ({
      campaign_id: campaignId,
      address: addr.address,
      formatted: addr.formatted,
      postal_code: addr.postal_code,
      source: addr.source,
      visited: addr.visited || false,
      coordinate: addr.coordinate,
      geom: addr.geom,
    }));

    const { error } = await this.client
      .from('campaign_addresses')
      .insert(addressesToInsert);

    if (error) throw error;

    // Update total_flyers count
    const { data: countData } = await this.client
      .from('campaign_addresses')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId);

    await this.client
      .from('campaigns')
      .update({ total_flyers: countData?.length || 0 })
      .eq('id', campaignId);
  }

  static async updateCampaign(id: string, updates: Partial<CampaignV2>): Promise<void> {
    const { error } = await this.client
      .from('campaigns')
      .update(updates)
      .eq('id', id);

    if (error) throw error;
  }

  static async deleteCampaign(id: string): Promise<void> {
    const { error } = await this.client
      .from('campaigns')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }

  // ============================================
  // QR Code Helper Methods
  // ============================================

  /**
   * Fetch all QR codes for a campaign
   */
  static async fetchCampaignQRCodes(campaignId: string): Promise<QRCode[]> {
    const { data, error } = await this.client
      .from('qr_codes')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  /**
   * Fetch QR codes for a campaign with scan statistics
   * Requires a server-side Supabase client (use getSupabaseServerClient() in API routes)
   */
  static async fetchCampaignQRScanStats(
    supabase: SupabaseClient,
    campaignId: string
  ): Promise<QRCodeWithScanStatus[]> {
    return QRCodeService.fetchQRCodesWithScanStatusForCampaign(supabase, campaignId);
  }

  /**
   * Fetch campaign bounding box using RPC function
   * Returns null if no valid geometries exist
   */
  static async fetchCampaignBoundingBox(
    campaignId: string
  ): Promise<{ minLon: number; minLat: number; maxLon: number; maxLat: number } | null> {
    const { data, error } = await this.client.rpc('get_campaign_bbox', {
      c_id: campaignId,
    });

    if (error) {
      console.error('Error fetching campaign bounding box:', error);
      return null;
    }

    if (!data || data.length === 0 || !data[0]) {
      return null;
    }

    const bbox = data[0];
    return {
      minLon: bbox.min_lon,
      minLat: bbox.min_lat,
      maxLon: bbox.max_lon,
      maxLat: bbox.max_lat,
    };
  }

  /**
   * Fetch surgical campaign stats from RPC
   * Returns aggregated metrics: addresses, buildings, visited, scanned, scan_rate, progress_pct
   */
  static async fetchCampaignStats(campaignId: string): Promise<CampaignStats> {
    const { data, error } = await this.client.rpc('rpc_get_campaign_stats', {
      p_campaign_id: campaignId,
    });

    if (error) {
      console.error('Error fetching campaign stats:', formatError(error));
      // Fallback: Query tables directly if RPC fails
      try {
        const { count: addressCount } = await this.client
          .from('campaign_addresses')
          .select('*', { count: 'exact', head: true })
          .eq('campaign_id', campaignId);

        return {
          addresses: addressCount || 0,
          contacts: 0,
          contacted: 0,
          visited: 0,
          scanned: 0,
          scan_rate: 0,
          progress_pct: 0,
        };
      } catch (fallbackError) {
        console.error('Fallback stats query failed:', formatError(fallbackError));
        return {
          addresses: 0,
          contacts: 0,
          contacted: 0,
          visited: 0,
          scanned: 0,
          scan_rate: 0,
          progress_pct: 0,
        };
      }
    }

    // Handle case where data might be a string (JSONB serialization)
    const stats = typeof data === 'string' ? JSON.parse(data) : data;

    const totalAddresses = stats?.addresses || 0;
    const visitedCount = stats?.visited || 0;
    const scannedCount = stats?.scanned || 0;
    const contactedCount = stats?.contacted || stats?.buildings || 0;
    const progressPct = totalAddresses > 0
      ? Math.round((visitedCount / totalAddresses) * 100)
      : 0;
    const scanRate = totalAddresses > 0
      ? Math.round((scannedCount / totalAddresses) * 100)
      : 0;

    return {
      addresses: totalAddresses,
      contacted: contactedCount,
      visited: visitedCount,
      scanned: scannedCount,
      scan_rate: stats?.scan_rate || scanRate,
      progress_pct: progressPct,
    };
  }
}

/**
 * Campaign statistics (lead-centric)
 */
export interface CampaignStats {
  addresses: number;    // Addresses in campaign (territory)
  contacts: number;     // Total leads = count of campaign_contacts (0 until user adds)
  contacted: number;    // Leads with a status set (talked, appointment, hot_lead, etc.)
  visited: number;      // Leads marked as visited
  scanned: number;      // Leads with at least one scan
  scan_rate: number;    // Percentage of leads scanned
  progress_pct: number; // Percentage of leads visited
}
