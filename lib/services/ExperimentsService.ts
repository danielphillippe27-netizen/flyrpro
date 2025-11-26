import { createClient } from '@/lib/supabase/client';
import type { Experiment, ExperimentVariant, QRScanEvent } from '@/types/database';

export class ExperimentsService {
  private static client = createClient();

  static async createExperiment(payload: {
    campaignId?: string;
    landingPageId?: string;
    name: string;
  }): Promise<Experiment> {
    const { data, error } = await this.client
      .from('experiments')
      .insert({
        campaign_id: payload.campaignId,
        landing_page_id: payload.landingPageId,
        name: payload.name,
        status: 'active',
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  static async fetchExperiment(id: string): Promise<Experiment | null> {
    const { data, error } = await this.client
      .from('experiments')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    return data || null;
  }

  static async createVariants(experimentId: string, variants: Array<{ key: 'A' | 'B'; urlSlug: string }>): Promise<ExperimentVariant[]> {
    const { data, error } = await this.client
      .from('experiment_variants')
      .insert(
        variants.map((v) => ({
          experiment_id: experimentId,
          key: v.key,
          url_slug: v.urlSlug,
        }))
      )
      .select();

    if (error) throw error;
    return data || [];
  }

  static async trackScan(payload: {
    experimentId?: string;
    variantId?: string;
    campaignId?: string;
    landingPageId?: string;
    deviceType?: string;
    city?: string;
  }): Promise<QRScanEvent> {
    const { data, error } = await this.client
      .from('qr_scan_events')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  static async getExperimentResults(experimentId: string): Promise<{
    variantA: { scans: number; conversions: number };
    variantB: { scans: number; conversions: number };
  }> {
    const { data: variants } = await this.client
      .from('experiment_variants')
      .select('*')
      .eq('experiment_id', experimentId);

    const variantA = variants?.find((v) => v.key === 'A');
    const variantB = variants?.find((v) => v.key === 'B');

    const [scansA, scansB] = await Promise.all([
      variantA
        ? this.client
            .from('qr_scan_events')
            .select('*', { count: 'exact', head: true })
            .eq('variant_id', variantA.id)
        : { count: 0 },
      variantB
        ? this.client
            .from('qr_scan_events')
            .select('*', { count: 'exact', head: true })
            .eq('variant_id', variantB.id)
        : { count: 0 },
    ]);

    return {
      variantA: {
        scans: (scansA as any)?.count || 0,
        conversions: 0, // Implement conversion tracking
      },
      variantB: {
        scans: (scansB as any)?.count || 0,
        conversions: 0,
      },
    };
  }
}

