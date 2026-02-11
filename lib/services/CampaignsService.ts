import { createClient } from '@/lib/supabase/client';
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

export class CampaignsService {
  private static client = createClient();

  static async fetchCampaignsV2(userId: string): Promise<CampaignV2[]> {
    const { data, error } = await this.client
      .from('campaigns')
      .select('*')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

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

  static async createV2(userId: string, payload: CreateCampaignPayload): Promise<CampaignV2> {
    const { data, error } = await this.client
      .from('campaigns')
      .insert({
        owner_id: userId,
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
        .order('street_name', { ascending: true })
        .order('address', { ascending: true });

      if (error) {
        console.error('Error fetching campaign addresses:', formatError(error));
        // Return empty array instead of throwing for graceful degradation
        if (error.code === 'PGRST205' || error.message?.includes('schema cache')) {
          console.warn('campaign_addresses_geojson view not found, returning empty array');
          return [];
        }
        throw error;
      }
      
      // Sort addresses naturally (so "142 Main St" comes before "1420 Main St")
      const sortedData = (data || []).sort((a: any, b: any) => {
        // First sort by street name
        const streetA = (a.street_name || '').toLowerCase();
        const streetB = (b.street_name || '').toLowerCase();
        if (streetA !== streetB) {
          return streetA.localeCompare(streetB);
        }
        
        // Then sort by house number numerically
        const numA = parseInt((a.address || '').match(/^\d+/)?.[0] || '0', 10);
        const numB = parseInt((b.address || '').match(/^\d+/)?.[0] || '0', 10);
        return numA - numB;
      });
      
      return sortedData as unknown as CampaignAddress[];
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
  static async fetchRecipients(campaignId: string): Promise<any[]> {
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
        
        // Check legacy buildings table
        const { count: legacyBuildingCount } = await this.client
          .from('buildings')
          .select('*', { count: 'exact', head: true })
          .eq('campaign_id', campaignId);
        
        // Check new snapshot-based architecture (S3 stored buildings)
        const { data: snapshot } = await this.client
          .from('campaign_snapshots')
          .select('buildings_count')
          .eq('campaign_id', campaignId)
          .single();
        
        const buildingCount = legacyBuildingCount || snapshot?.buildings_count || 0;

        return {
          addresses: addressCount || 0,
          buildings: buildingCount,
          visited: 0,
          scanned: 0,
          scan_rate: 0,
          progress_pct: 0,
        };
      } catch (fallbackError) {
        console.error('Fallback stats query failed:', formatError(fallbackError));
        return {
          addresses: 0,
          buildings: 0,
          visited: 0,
          scanned: 0,
          scan_rate: 0,
          progress_pct: 0,
        };
      }
    }

    // Handle case where data might be a string (JSONB serialization)
    const stats = typeof data === 'string' ? JSON.parse(data) : data;
    
    // If RPC returns 0 buildings, check snapshot (Gold Standard architecture)
    let buildingCount = stats?.buildings || 0;
    if (buildingCount === 0) {
      try {
        const { data: snapshot } = await this.client
          .from('campaign_snapshots')
          .select('buildings_count')
          .eq('campaign_id', campaignId)
          .single();
        buildingCount = snapshot?.buildings_count || 0;
      } catch {
        // Ignore snapshot lookup errors
      }
    }
    
    return {
      addresses: stats?.addresses || 0,
      buildings: buildingCount,
      visited: stats?.visited || 0,
      scanned: stats?.scanned || 0,
      scan_rate: stats?.scan_rate || 0,
      progress_pct: stats?.progress_pct || 0,
    };
  }
}

/**
 * Surgical campaign statistics from rpc_get_campaign_stats
 */
export interface CampaignStats {
  addresses: number;    // Total human leads (campaign_addresses count)
  buildings: number;    // Total physical targets (buildings count)
  visited: number;      // Doors knocked (buildings with status != available/default)
  scanned: number;      // Addresses with at least one scan
  scan_rate: number;    // Percentage of addresses scanned
  progress_pct: number; // Percentage of buildings visited
}

