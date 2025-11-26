import { createClient } from '@/lib/supabase/client';
import type { QRCode, QRSet, Batch } from '@/types/database';

export class QRCodeService {
  private static client = createClient();

  static async fetchQRCodes(filters?: {
    campaignId?: string;
    farmId?: string;
    addressId?: string;
    batchId?: string;
  }): Promise<QRCode[]> {
    let query = this.client.from('qr_codes').select('*');

    if (filters?.campaignId) {
      query = query.eq('campaign_id', filters.campaignId);
    }
    if (filters?.farmId) {
      query = query.eq('farm_id', filters.farmId);
    }
    if (filters?.addressId) {
      query = query.eq('address_id', filters.addressId);
    }
    if (filters?.batchId) {
      query = query.eq('batch_id', filters.batchId);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;
    return data || [];
  }

  static async createQRCode(payload: {
    campaignId?: string;
    farmId?: string;
    addressId?: string;
    batchId?: string;
    landingPageId?: string;
    qrVariant?: 'A' | 'B';
    slug?: string;
    qrUrl: string;
    qrImage?: string;
    metadata?: Record<string, any>;
  }): Promise<QRCode> {
    const { data, error } = await this.client
      .from('qr_codes')
      .insert({
        campaign_id: payload.campaignId,
        farm_id: payload.farmId,
        address_id: payload.addressId,
        batch_id: payload.batchId,
        landing_page_id: payload.landingPageId,
        qr_variant: payload.qrVariant,
        slug: payload.slug,
        qr_url: payload.qrUrl,
        qr_image: payload.qrImage,
        metadata: payload.metadata,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Generate a unique 8-character lowercase alphanumeric slug
   */
  static generateSlug(length: number = 8): string {
    const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let slug = '';
    for (let i = 0; i < length; i++) {
      slug += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return slug;
  }

  /**
   * Check if a slug is available (not already in use)
   */
  static async isSlugAvailable(slug: string): Promise<boolean> {
    const { data, error } = await this.client
      .from('qr_codes')
      .select('id')
      .eq('slug', slug)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') throw error;
    return !data; // Available if no data found
  }

  /**
   * Generate a unique slug that's not already in use
   */
  static async generateUniqueSlug(length: number = 8, maxAttempts: number = 10): Promise<string> {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const slug = this.generateSlug(length);
      const available = await this.isSlugAvailable(slug);
      if (available) {
        return slug;
      }
    }
    throw new Error('Failed to generate unique slug after maximum attempts');
  }

  /**
   * Link QR code to landing page with optional variant and slug
   * Updates qr_url to match the slug format: https://flyrpro.app/q/<slug>
   */
  static async linkToLandingPage(
    qrCodeId: string,
    landingPageId: string,
    options?: {
      qrVariant?: 'A' | 'B';
      slug?: string;
    }
  ): Promise<QRCode> {
    const updateData: any = {
      landing_page_id: landingPageId,
    };

    // Generate or use provided slug
    let slug = options?.slug;
    if (!slug) {
      slug = await this.generateUniqueSlug();
    } else {
      // Verify provided slug is available
      const available = await this.isSlugAvailable(slug);
      if (!available) {
        throw new Error(`Slug "${slug}" is already in use`);
      }
    }

    updateData.slug = slug;
    updateData.qr_url = `https://flyrpro.app/q/${slug}`;

    if (options?.qrVariant) {
      updateData.qr_variant = options.qrVariant;
    }

    const { data, error } = await this.client
      .from('qr_codes')
      .update(updateData)
      .eq('id', qrCodeId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  static async fetchAnalytics(qrCodeId: string): Promise<{
    scans: number;
    conversions: number;
    lastScanned?: string;
  }> {
    // Query qr_scan_events table
    const { data: scans, error } = await this.client
      .from('qr_scan_events')
      .select('*', { count: 'exact' })
      .eq('qr_code_id', qrCodeId);

    if (error) throw error;

    // Get last scan
    const { data: lastScan } = await this.client
      .from('qr_scan_events')
      .select('created_at')
      .eq('qr_code_id', qrCodeId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    return {
      scans: scans?.length || 0,
      conversions: 0, // Implement conversion tracking
      lastScanned: lastScan?.created_at,
    };
  }

  static async createQRSet(payload: {
    name: string;
    totalAddresses: number;
    variantCount: number;
    qrCodeIds: string[];
    campaignId?: string;
    userId: string;
  }): Promise<QRSet> {
    const { data, error } = await this.client
      .from('qr_sets')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  static async createBatch(payload: {
    name: string;
    campaignId?: string;
    userId: string;
  }): Promise<Batch> {
    const { data, error } = await this.client
      .from('batches')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    return data;
  }
}

