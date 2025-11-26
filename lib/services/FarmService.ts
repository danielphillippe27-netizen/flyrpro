import { createClient } from '@/lib/supabase/client';
import type { Farm, FarmTouch, FarmLead } from '@/types/database';
import type { CreateFarmPayload } from '@/types/farms';

export class FarmService {
  private static client = createClient();

  static async fetchFarms(userId: string): Promise<Farm[]> {
    const { data, error } = await this.client
      .from('farms')
      .select('*')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Compute progress for each farm
    return (data || []).map((farm) => {
      const startDate = new Date(farm.start_date);
      const endDate = new Date(farm.end_date);
      const now = new Date();
      const totalDuration = endDate.getTime() - startDate.getTime();
      const elapsed = now.getTime() - startDate.getTime();
      const progress = totalDuration > 0 ? Math.min(Math.max(elapsed / totalDuration, 0), 1) : 0;

      return {
        ...farm,
        progress,
        is_active: farm.is_active ?? true,
      } as Farm;
    });
  }

  static async fetchFarm(id: string): Promise<Farm | null> {
    const { data, error } = await this.client
      .from('farms')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    if (!data) return null;

    const startDate = new Date(data.start_date);
    const endDate = new Date(data.end_date);
    const now = new Date();
    const totalDuration = endDate.getTime() - startDate.getTime();
    const elapsed = now.getTime() - startDate.getTime();
    const progress = totalDuration > 0 ? Math.min(Math.max(elapsed / totalDuration, 0), 1) : 0;

    return {
      ...data,
      progress,
      is_active: data.is_active ?? true,
    } as Farm;
  }

  static async createFarm(userId: string, payload: CreateFarmPayload): Promise<Farm> {
    const { data, error } = await this.client
      .from('farms')
      .insert({
        owner_id: userId,
        name: payload.name,
        polygon: payload.polygon,
        start_date: payload.start_date,
        end_date: payload.end_date,
        frequency: payload.frequency,
        is_active: true,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  static async updatePolygon(farmId: string, polygon: string): Promise<void> {
    const { error } = await this.client
      .from('farms')
      .update({ polygon })
      .eq('id', farmId);

    if (error) throw error;
  }

  static async updateFarm(id: string, updates: Partial<Farm>): Promise<void> {
    const { error } = await this.client
      .from('farms')
      .update(updates)
      .eq('id', id);

    if (error) throw error;
  }

  static async deleteFarm(id: string): Promise<void> {
    const { error } = await this.client
      .from('farms')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }
}

export class FarmTouchService {
  private static client = createClient();

  static async scheduleTouch(payload: {
    farmId: string;
    scheduledDate: string;
    notes?: string;
  }): Promise<FarmTouch> {
    const { data, error } = await this.client
      .from('farm_touches')
      .insert({
        farm_id: payload.farmId,
        scheduled_date: payload.scheduledDate,
        status: 'scheduled',
        notes: payload.notes,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  static async fetchTouches(farmId: string): Promise<FarmTouch[]> {
    const { data, error } = await this.client
      .from('farm_touches')
      .select('*')
      .eq('farm_id', farmId)
      .order('scheduled_date', { ascending: true });

    if (error) throw error;
    return data || [];
  }

  static async completeTouch(touchId: string, notes?: string): Promise<void> {
    const { error } = await this.client
      .from('farm_touches')
      .update({
        status: 'completed',
        completed_date: new Date().toISOString(),
        notes,
      })
      .eq('id', touchId);

    if (error) throw error;
  }
}

export class FarmLeadService {
  private static client = createClient();

  static async createLead(payload: {
    farmId: string;
    touchId?: string;
    leadSource: string;
    name?: string;
    phone?: string;
    email?: string;
    address?: string;
  }): Promise<FarmLead> {
    const { data, error } = await this.client
      .from('farm_leads')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  static async fetchLeads(farmId: string): Promise<FarmLead[]> {
    const { data, error } = await this.client
      .from('farm_leads')
      .select('*')
      .eq('farm_id', farmId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }
}

