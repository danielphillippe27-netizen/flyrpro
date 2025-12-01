import { createClient } from '@/lib/supabase/client';
import type { Flyer, FlyerData } from '@/lib/flyers/types';

export class FlyerEditorService {
  private static client = createClient();

  /**
   * Get a flyer by ID
   */
  static async getFlyerById(flyerId: string): Promise<Flyer | null> {
    const { data, error } = await this.client
      .from('flyers')
      .select('*')
      .eq('id', flyerId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // Not found
      }
      throw error;
    }

    if (!data) return null;

    return {
      id: data.id,
      campaign_id: data.campaign_id,
      name: data.name,
      size: data.size,
      data: data.data as FlyerData,
      created_at: data.created_at,
      updated_at: data.updated_at,
    };
  }

  /**
   * Create a default flyer for a campaign
   */
  static async createDefaultFlyer(campaignId: string, name: string = 'New Flyer'): Promise<Flyer> {
    const defaultData: FlyerData = {
      backgroundColor: '#ffffff',
      elements: [],
    };

    const { data, error } = await this.client
      .from('flyers')
      .insert({
        campaign_id: campaignId,
        name,
        size: 'LETTER_8_5x11',
        data: defaultData,
      })
      .select()
      .single();

    if (error) throw error;

    return {
      id: data.id,
      campaign_id: data.campaign_id,
      name: data.name,
      size: data.size,
      data: data.data as FlyerData,
      created_at: data.created_at,
      updated_at: data.updated_at,
    };
  }

  /**
   * Update flyer data
   */
  static async updateFlyerData(flyerId: string, data: FlyerData): Promise<void> {
    const { error } = await this.client
      .from('flyers')
      .update({
        data,
        updated_at: new Date().toISOString(),
      })
      .eq('id', flyerId);

    if (error) throw error;
  }

  /**
   * Update flyer name
   */
  static async updateFlyerName(flyerId: string, name: string): Promise<void> {
    const { error } = await this.client
      .from('flyers')
      .update({
        name,
        updated_at: new Date().toISOString(),
      })
      .eq('id', flyerId);

    if (error) throw error;
  }

  /**
   * Delete a flyer
   */
  static async deleteFlyer(flyerId: string): Promise<void> {
    const { error } = await this.client
      .from('flyers')
      .delete()
      .eq('id', flyerId);

    if (error) throw error;
  }
}


