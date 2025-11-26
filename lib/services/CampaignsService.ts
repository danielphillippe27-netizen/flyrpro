import { createClient } from '@/lib/supabase/client';
import type { CampaignV2, CampaignAddress } from '@/types/database';
import type { CreateCampaignPayload } from '@/types/campaigns';

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

    if (error) throw error;
    if (!data) return null;

    const totalFlyers = data.total_flyers || 0;
    const scans = data.scans || 0;
    const progress = totalFlyers > 0 ? scans / totalFlyers : 0;
    const progressPct = Math.round(progress * 100);

    return {
      ...data,
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
    const { data, error } = await this.client
      .from('campaign_addresses')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
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
}

