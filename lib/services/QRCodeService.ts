import { createClient } from '@/lib/supabase/client';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import type { QRCode, QRSet, Batch } from '@/types/database';
import type { SupabaseClient } from '@supabase/supabase-js';

// Destination type for QR codes
export type QRDestinationType = 'landingPage' | 'directLink';

// Extended QRCode interface with new fields
export interface QRCodeWithDestination extends QRCode {
  destination_type?: QRDestinationType | null;
  direct_url?: string | null;
}

// QR Code Scan types
export interface QRCodeScan {
  id: string;
  qr_code_id: string | null;
  address_id: string | null;
  scanned_at: string; // ISO timestamp
  device_info?: string | null;
  user_agent?: string | null;
  ip_address?: string | null;
  referrer?: string | null;
}

export interface QRCodeWithScanStatus extends QRCodeWithDestination {
  hasBeenScanned: boolean;
  scanCount?: number;
}

// Arguments for creating QR code with destination
export interface CreateQRCodeArgs {
  campaignId?: string | null;
  addressId?: string | null;
  destinationType: QRDestinationType;
  landingPageId?: string | null;
  directUrl?: string | null;
  qrVariant?: string | null; // 'A' | 'B' | etc.
}

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

  // ============================================
  // Server-Side Methods (for API routes)
  // ============================================

  /**
   * Server-side helper to generate a unique slug
   */
  static async generateUniqueSlugServer(
    supabase: SupabaseClient,
    length: number = 8,
    maxTries: number = 5
  ): Promise<string> {
    for (let i = 0; i < maxTries; i++) {
      const slug = this.generateSlug(length);
      const { data, error } = await supabase
        .from('qr_codes')
        .select('id')
        .eq('slug', slug)
        .maybeSingle();

      if (!error && !data) {
        return slug;
      }
    }
    throw new Error('Failed to generate unique QR slug');
  }

  /**
   * Create a QR code with destination type (landing page or direct link)
   * This is a server-side method that uses getSupabaseServerClient()
   */
  static async createQRCodeWithDestination(args: CreateQRCodeArgs): Promise<QRCodeWithDestination> {
    const supabase = await getSupabaseServerClient();

    const {
      campaignId,
      addressId,
      destinationType,
      landingPageId,
      directUrl,
      qrVariant,
    } = args;

    if (destinationType === 'landingPage' && !landingPageId) {
      throw new Error('landingPage destination requires landingPageId');
    }
    if (destinationType === 'directLink' && !directUrl) {
      throw new Error('directLink destination requires directUrl');
    }

    const slug = await this.generateUniqueSlugServer(supabase);
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://flyrpro.app';
    const qrUrl = `${baseUrl}/q/${slug}`;

    const { data, error } = await supabase
      .from('qr_codes')
      .insert({
        slug,
        qr_url: qrUrl,
        destination_type: destinationType,
        landing_page_id: destinationType === 'landingPage' ? landingPageId : null,
        direct_url: destinationType === 'directLink' ? directUrl : null,
        qr_variant: qrVariant ?? null,
        campaign_id: campaignId ?? null,
        address_id: addressId ?? null,
      })
      .select('*')
      .single();

    if (error || !data) {
      throw error ?? new Error('Failed to create QR code');
    }

    return data as QRCodeWithDestination;
  }

  /**
   * Get scan count for a specific QR code
   */
  static async getScanCountForQRCode(qrCodeId: string): Promise<number> {
    const supabase = await getSupabaseServerClient();

    const { count, error } = await supabase
      .from('qr_code_scans')
      .select('id', { head: true, count: 'exact' })
      .eq('qr_code_id', qrCodeId);

    if (error) {
      throw error;
    }

    return count ?? 0;
  }

  /**
   * Fetch all QR codes for a campaign along with scan status
   */
  static async fetchQRCodesWithScanStatusForCampaign(
    campaignId: string
  ): Promise<QRCodeWithScanStatus[]> {
    const supabase = await getSupabaseServerClient();

    const { data: qrCodes, error: qrError } = await supabase
      .from('qr_codes')
      .select('*')
      .eq('campaign_id', campaignId);

    if (qrError || !qrCodes) {
      throw qrError ?? new Error('Failed to fetch QR codes for campaign');
    }

    if (qrCodes.length === 0) {
      return [];
    }

    const qrCodeIds = qrCodes.map((q) => q.id);

    const { data: scans, error: scanError } = await supabase
      .from('qr_code_scans')
      .select('qr_code_id')
      .in('qr_code_id', qrCodeIds);

    if (scanError) {
      throw scanError;
    }

    const scannedSet = new Set<string>(
      (scans ?? [])
        .map((s) => s.qr_code_id)
        .filter((id): id is string => !!id)
    );

    // Compute scanCount per code
    const counts: Record<string, number> = {};
    (scans ?? []).forEach((scan) => {
      if (!scan.qr_code_id) return;
      counts[scan.qr_code_id] = (counts[scan.qr_code_id] ?? 0) + 1;
    });

    return qrCodes.map((qr) => ({
      ...(qr as QRCodeWithDestination),
      hasBeenScanned: scannedSet.has(qr.id),
      scanCount: counts[qr.id] ?? 0,
    }));
  }
}

