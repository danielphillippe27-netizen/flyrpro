import { createClient } from '@/lib/supabase/client';

export class BuildingColorService {
  private static client = createClient();

  /**
   * Update building color in Supabase
   */
  static async updateBuildingColor(
    addressId: string,
    color: string
  ): Promise<void> {
    // Update the building_polygons table or a separate colors table
    // For now, we'll assume there's a color column or we'll store it in campaign_addresses
    const { error } = await this.client
      .from('campaign_addresses')
      .update({ color })
      .eq('id', addressId);

    if (error) {
      throw new Error(`Failed to update building color: ${error.message}`);
    }
  }

  /**
   * Batch update building colors
   */
  static async batchUpdateBuildingColors(
    updates: Array<{ addressId: string; color: string }>
  ): Promise<void> {
    // Use a transaction or batch update
    const promises = updates.map(({ addressId, color }) =>
      this.updateBuildingColor(addressId, color)
    );

    await Promise.all(promises);
  }

  /**
   * Get building color from database
   */
  static async getBuildingColor(addressId: string): Promise<string | null> {
    const { data, error } = await this.client
      .from('campaign_addresses')
      .select('color')
      .eq('id', addressId)
      .single();

    if (error) {
      console.error('Error fetching building color:', error);
      return null;
    }

    return data?.color || null;
  }
}

