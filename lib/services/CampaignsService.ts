import { createClient } from '@/lib/supabase/client';
import type { CampaignV2, CampaignAddress, QRCode } from '@/types/database';
import type { CreateCampaignPayload } from '@/types/campaigns';
import { QRCodeService } from '@/lib/services/QRCodeService';
import type { QRCodeWithScanStatus } from '@/lib/services/QRCodeService';
import type { SupabaseClient } from '@supabase/supabase-js';

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
        .order('seq', { ascending: true });

      if (error) {
        console.error('Error fetching campaign addresses:', error);
        // Return empty array instead of throwing for graceful degradation
        if (error.code === 'PGRST205' || error.message?.includes('schema cache')) {
          console.warn('campaign_addresses table not found, returning empty array');
          return [];
        }
        throw error;
      }
      return (data || []) as unknown as CampaignAddress[];
    } catch (error) {
      console.error('Error fetching addresses, returning empty array:', error);
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
}

