import { createClient } from '@/lib/supabase/client';
import { fetchAllInPages } from '@/lib/supabase/fetchAllInPages';
import type { CampaignV2, CampaignAddress, QRCode } from '@/types/database';
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

function isWorkspaceCampaignLimitError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; message?: string; details?: string; hint?: string };
  return (
    e.code === 'P0001' &&
    (e.message?.includes('workspace_campaign_limit_reached') ||
      e.details?.includes('included campaign') ||
      e.hint?.includes('workspace_campaign_limit_reached') ||
      false)
  );
}

type CampaignAddressBaseState = {
  building_id: string | null;
  building_gers_id: string | null;
  gers_id: string | null;
  source_id: string | null;
  visited: boolean;
  scans: number;
  last_scanned_at: string | null;
};

type CampaignAddressStatusRow = {
  campaign_address_id?: string | null;
  address_id?: string | null;
  status?: string | null;
  updated_at?: string | null;
};

type CampaignAddressFetchOptions = {
  addressIds?: string[] | null;
};

type CampaignAssignmentVisibilityRow = {
  campaign_id?: string | null;
};

type WorkspaceRoleRow = {
  role?: string | null;
};

function isWorkspaceManagerRole(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

function normalizeAddressIdFilter(addressIds: string[] | null | undefined): string[] | null {
  if (!Array.isArray(addressIds)) return null;
  return Array.from(
    new Set(
      addressIds
        .map((value) => String(value ?? '').trim())
        .filter(Boolean)
    )
  );
}

export class CampaignsService {
  private static client = createClient();

  private static normalizeCampaign(campaign: Record<string, unknown>): CampaignV2 {
    const totalFlyers = Number(campaign.total_flyers || 0);
    const scans = Number(campaign.scans || 0);
    const progress = totalFlyers > 0 ? scans / totalFlyers : 0;
    const progressPct = Math.round(progress * 100);

    return {
      ...campaign,
      owner_id: String(campaign.owner_id || campaign.user_id || ''),
      name: String(campaign.title || campaign.name || 'Unnamed Campaign'),
      type: (campaign.type || 'flyer') as CampaignV2['type'],
      progress,
      progress_pct: progressPct,
    } as CampaignV2;
  }

  private static async fetchAssignedCampaignIds(userId: string, workspaceId?: string | null): Promise<string[]> {
    let query = this.client
      .from('campaign_assignments')
      .select('campaign_id')
      .eq('assigned_to_user_id', userId)
      .neq('status', 'cancelled')
      .limit(1000);

    if (workspaceId) {
      query = query.eq('workspace_id', workspaceId);
    }

    const { data, error } = await query;
    if (error) {
      const message = formatError(error);
      if (message.includes('campaign_assignments')) {
        console.warn('fetchAssignedCampaignIds:', message);
        return [];
      }
      throw error;
    }

    return Array.from(
      new Set(
        ((data ?? []) as CampaignAssignmentVisibilityRow[])
          .map((assignment) => assignment.campaign_id)
          .filter((id): id is string => Boolean(id))
      )
    );
  }

  private static async fetchWorkspaceRole(userId: string, workspaceId: string): Promise<string | null> {
    const { data, error } = await this.client
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.warn('fetchWorkspaceRole:', formatError(error));
      return null;
    }

    return ((data as WorkspaceRoleRow | null)?.role ?? null) || null;
  }

  static async fetchCampaignsV2(userId: string, workspaceId?: string | null): Promise<CampaignV2[]> {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams();
      if (workspaceId) params.set('workspaceId', workspaceId);
      const response = await fetch(`/api/campaigns${params.size > 0 ? `?${params.toString()}` : ''}`, {
        credentials: 'include',
        cache: 'no-store',
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? 'Failed to fetch campaigns');
      }

      const data = await response.json();
      return Array.isArray(data)
        ? data.map((campaign) => this.normalizeCampaign(campaign as Record<string, unknown>))
        : [];
    }

    const campaignRows = new Map<string, Record<string, unknown>>();
    const workspaceRole = workspaceId ? await this.fetchWorkspaceRole(userId, workspaceId) : null;

    let baseQuery = this.client
      .from('campaigns')
      .select('*')
      .order('created_at', { ascending: false });

    if (workspaceId) {
      baseQuery = baseQuery.eq('workspace_id', workspaceId);
      if (!isWorkspaceManagerRole(workspaceRole)) {
        baseQuery = baseQuery.eq('owner_id', userId);
      }
    } else {
      baseQuery = baseQuery.eq('owner_id', userId);
    }

    const { data: ownOrManagedCampaigns, error: ownError } = await baseQuery;
    if (ownError) throw ownError;

    for (const campaign of ownOrManagedCampaigns ?? []) {
      campaignRows.set(campaign.id, campaign as Record<string, unknown>);
    }

    if (!workspaceId || !isWorkspaceManagerRole(workspaceRole)) {
      const assignedCampaignIds = await this.fetchAssignedCampaignIds(userId, workspaceId);
      const missingAssignedIds = assignedCampaignIds.filter((id) => !campaignRows.has(id));

      if (missingAssignedIds.length > 0) {
        const { data: assignedCampaigns, error: assignedError } = await this.client
          .from('campaigns')
          .select('*')
          .in('id', missingAssignedIds)
          .order('created_at', { ascending: false });

        if (assignedError) throw assignedError;
        for (const campaign of assignedCampaigns ?? []) {
          campaignRows.set(campaign.id, campaign as Record<string, unknown>);
        }
      }
    }

    return Array.from(campaignRows.values())
      .map((campaign) => this.normalizeCampaign(campaign))
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }

  static async fetchCampaign(id: string): Promise<CampaignV2 | null> {
    if (typeof window !== 'undefined') {
      const response = await fetch(`/api/campaigns/${encodeURIComponent(id)}`, {
        credentials: 'include',
        cache: 'no-store',
      });

      if (response.status === 404) {
        console.warn('Campaign not found:', id);
        return null;
      }

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? `Failed to fetch campaign ${id}`);
      }

      const data = await response.json();
      return this.normalizeCampaign(data as Record<string, unknown>);
    }

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

    return this.normalizeCampaign(data as Record<string, unknown>);
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

    if (error) {
      if (isWorkspaceCampaignLimitError(error)) {
        const limitError = new Error('This workspace already has its included campaign. Upgrade to create more campaigns.');
        (limitError as Error & { code?: string }).code = 'workspace_campaign_limit_reached';
        throw limitError;
      }
      throw error;
    }

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

  static async fetchAddresses(campaignId: string, options: CampaignAddressFetchOptions = {}): Promise<CampaignAddress[]> {
    const scopedAddressIds = normalizeAddressIdFilter(options.addressIds);
    if (scopedAddressIds && scopedAddressIds.length === 0) return [];

    try {
      const data = await fetchAllInPages(async (from, to) => {
        let query = this.client
          .from('campaign_addresses_geojson')
          .select('*, qr_code_base64') // Explicitly include qr_code_base64
          .eq('campaign_id', campaignId);
        if (scopedAddressIds) query = query.in('id', scopedAddressIds);
        return await query
          .order('seq', { ascending: true, nullsFirst: false })
          .order('id', { ascending: true })
          .range(from, to);
      });
      const baseState = await fetchAllInPages(async (from, to) => {
        let query = this.client
          .from('campaign_addresses')
          .select('id, building_id, building_gers_id, gers_id, source_id, visited, scans, last_scanned_at')
          .eq('campaign_id', campaignId);
        if (scopedAddressIds) query = query.in('id', scopedAddressIds);
        return await query
          .order('id', { ascending: true })
          .range(from, to);
      });
      const statusRows = await fetchAllInPages(async (from, to) => {
        let query = this.client
          .from('address_statuses')
          .select('campaign_address_id, status, updated_at')
          .eq('campaign_id', campaignId);
        if (scopedAddressIds) query = query.in('campaign_address_id', scopedAddressIds);
        return await query
          .order('updated_at', { ascending: false, nullsFirst: false })
          .range(from, to);
      });

      const statusByAddressId = new Map<string, string>();
      for (const row of (statusRows || []) as CampaignAddressStatusRow[]) {
        const addressId = row.campaign_address_id ?? row.address_id ?? null;
        const status = row.status?.trim();
        if (addressId && status && !statusByAddressId.has(addressId)) {
          statusByAddressId.set(addressId, status);
        }
      }

      const stateById = new Map<string, CampaignAddressBaseState>(
        (baseState || []).map((row) => [
          (row as { id: string }).id,
          {
            building_id: (row as { building_id?: string | null }).building_id ?? null,
            building_gers_id: (row as { building_gers_id?: string | null }).building_gers_id ?? null,
            gers_id: (row as { gers_id?: string | null }).gers_id ?? null,
            source_id: (row as { source_id?: string | null }).source_id ?? null,
            visited: Boolean((row as { visited?: boolean | null }).visited),
            scans: Number((row as { scans?: number | null }).scans ?? 0),
            last_scanned_at: (row as { last_scanned_at?: string | null }).last_scanned_at ?? null,
          },
        ])
      );

      return ((data || []) as Array<CampaignAddress & { building_id?: string | null }>).map((row) => {
        const state = stateById.get(row.id);
        const merged: CampaignAddress = {
          ...row,
          ...(state ?? {}),
        };
        const addressStatus = statusByAddressId.get(row.id) ?? row.address_status;
        if (addressStatus !== undefined) {
          merged.address_status = addressStatus;
        }
        return merged;
      });
    } catch (error) {
      console.error('Error fetching addresses, returning empty array:', formatError(error));
      // Gracefully handle errors - return empty array instead of crashing
      return [];
    }
  }

  /**
   * @deprecated This method is deprecated. Use fetchAddresses() instead.
   * CSV uploads now go directly to campaign_addresses table.
   * This method is kept for backward compatibility but always returns an empty array.
   */
  static async fetchRecipients(): Promise<unknown[]> {
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
    const response = await fetch(`/api/campaigns/${id}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(payload?.error || 'Failed to delete campaign');
    }
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
      contacts: stats?.contacts || 0,
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
