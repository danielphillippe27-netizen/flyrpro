import { createClient } from '@/lib/supabase/client';
import type { BuildingPolygon, Coordinate } from '@/types/database';

export class MapService {
  private static client = createClient();

  static async fetchBuildingPolygons(addressIds: string[]): Promise<BuildingPolygon[]> {
    if (addressIds.length === 0) return [];

    const { data, error } = await this.client
      .from('building_polygons')
      .select('*')
      .in('address_id', addressIds);

    if (error) throw error;
    return data || [];
  }

  static async fetchBuildingPolygonForAddress(addressId: string): Promise<BuildingPolygon | null> {
    const { data, error } = await this.client
      .from('building_polygons')
      .select('*')
      .eq('address_id', addressId)
      .single();

    if (error && error.code !== 'PGRST116') throw error; // PGRST116 = not found
    return data || null;
  }

  static async requestBuildingPolygons(addresses: Array<{ id: string; lat: number; lon: number }>): Promise<{
    created: number;
    updated: number;
  }> {
    // Call Supabase Edge Function or API route
    const response = await fetch('/api/mapbox/tilequery-buildings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addresses }),
    });

    if (!response.ok) {
      throw new Error('Failed to fetch building polygons');
    }

    return response.json();
  }

  static async geocodeAddress(address: string): Promise<Coordinate | null> {
    // Use Mapbox Geocoding API or Supabase function
    // For now, return null - implement based on your geocoding solution
    return null;
  }
}

