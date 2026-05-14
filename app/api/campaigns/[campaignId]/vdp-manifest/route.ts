import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { CampaignsService } from '@/lib/services/CampaignsService';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * GET /api/campaigns/[campaignId]/vdp-manifest
 * 
 * Generates a CSV manifest file for Variable Data Printing (VDP).
 * Professional printers use this CSV to merge QR codes and variable data into print templates.
 * 
 * Returns CSV with columns:
 * - reference_id: Unique identifier for printer tracking
 * - address_line, city, region, postal_code: Recipient address
 * - qr_url: QR code URL (short slug URL if available, otherwise long URL)
 * - campaign_id, campaign_name: Campaign metadata
 * - print_quantity: Number of copies (default: 1)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    /*
     * Generates the VDP CSV that printers use to merge address data and QR URLs
     * into print templates. Web-generated campaigns store QR images in
     * campaign_addresses.qr_code_base64 and the encoded scan URL in purl; the
     * qr_codes table is not populated by generate-qrs. This route now filters
     * on the active base64 QR field and uses purl as qr_url so the CSV matches
     * the printed QR image exactly. See QR_SYSTEM.md for the full context and
     * future slug-based Model B migration.
     */
    const { campaignId } = await params;

    if (!campaignId) {
      return NextResponse.json(
        { error: 'campaignId is required' },
        { status: 400 }
      );
    }

    const supabase = await getSupabaseServerClient();

    // Authenticate user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Authentication required' },
        { status: 401 }
      );
    }

    // Fetch campaign
    const campaign = await CampaignsService.fetchCampaign(campaignId);
    if (!campaign) {
      return NextResponse.json(
        { error: 'Campaign not found' },
        { status: 404 }
      );
    }

    // Verify ownership
    const ownerId = campaign.owner_id || (campaign as { user_id?: string | null }).user_id;
    if (ownerId !== user.id) {
      return NextResponse.json(
        { error: 'Forbidden', message: 'You do not have access to this campaign' },
        { status: 403 }
      );
    }

    const adminSupabase = createAdminClient();

    // Fetch addresses with QR codes
    const { data: addresses, error: addressesError } = await adminSupabase
      .from('campaign_addresses')
      .select(`
        id,
        address,
        formatted,
        postal_code,
        qr_png_url,
        purl,
        seq
      `)
      .eq('campaign_id', campaignId)
      .not('qr_code_base64', 'is', null)
      .order('seq', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true });

    if (addressesError) {
      console.error('Error fetching addresses:', addressesError);
      return NextResponse.json(
        { error: 'Failed to fetch addresses', details: addressesError.message },
        { status: 500 }
      );
    }

    if (!addresses || addresses.length === 0) {
      return NextResponse.json(
        { error: 'No addresses with QR codes found for this campaign' },
        { status: 404 }
      );
    }

    // Parse address components from formatted address
    const parseAddress = (formatted: string) => {
      // Try to extract city, region, postal_code from formatted string
      // Format is typically: "123 Main St, City, Region, PostalCode"
      const parts = formatted.split(',').map((p) => p.trim());
      
      if (parts.length >= 4) {
        return {
          address_line: parts[0],
          city: parts[1],
          region: parts[2],
          postal_code: parts[3],
        };
      } else if (parts.length === 3) {
        return {
          address_line: parts[0],
          city: parts[1],
          region: parts[2],
          postal_code: '',
        };
      } else if (parts.length === 2) {
        return {
          address_line: parts[0],
          city: parts[1],
          region: '',
          postal_code: '',
        };
      } else {
        return {
          address_line: formatted,
          city: '',
          region: '',
          postal_code: '',
        };
      }
    };

    // Generate CSV rows
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL || 'https://flyrpro.app';
    const rows = addresses.map((address, index) => {
      // qr_url for the CSV: use the purl column which contains the exact
      // URL already encoded in the printed QR image (/api/scan?id={address_id}).
      // This ensures the URL in the CSV and the URL in the QR code are always
      // identical and consistent.
      //
      // Note: We intentionally do not use the qr_codes table here. The qr_codes
      // table is empty for web-generated campaigns (generate-qrs does not insert
      // there). A future migration to slug-based URLs (/q/{slug}) will update
      // this when a staging environment is available. See QR_SYSTEM.md Section 8
      // for the full fix specification.
      const qrUrl = address.purl
        || `${baseUrl}/api/scan?id=${address.id}`;

      const addressParts = parseAddress(address.formatted || address.address || '');
      const referenceId = `REF-${String(index + 1).padStart(6, '0')}`;

      return {
        reference_id: referenceId,
        address_line: addressParts.address_line,
        city: addressParts.city,
        region: addressParts.region,
        postal_code: address.postal_code || addressParts.postal_code,
        qr_url: qrUrl,
        campaign_id: campaignId,
        campaign_name: campaign.name || 'Unnamed Campaign',
        print_quantity: '1',
      };
    });

    // Generate CSV content
    const headers = [
      'reference_id',
      'address_line',
      'city',
      'region',
      'postal_code',
      'qr_url',
      'campaign_id',
      'campaign_name',
      'print_quantity',
    ];

    // Escape CSV values (handle commas, quotes, newlines)
    const escapeCsvValue = (value: string | null | undefined): string => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      // If value contains comma, quote, or newline, wrap in quotes and escape internal quotes
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const csvRows = [
      headers.join(','),
      ...rows.map((row) =>
        headers.map((header) => escapeCsvValue(row[header as keyof typeof row])).join(',')
      ),
    ];

    const csvContent = csvRows.join('\n');

    // Return CSV file
    return new NextResponse(csvContent, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="vdp-manifest-${campaignId}-${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
  } catch (error) {
    console.error('Error generating VDP manifest:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
