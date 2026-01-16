import { NextRequest, NextResponse } from 'next/server';
import JSZip from 'jszip';
import { createAdminClient } from '@/lib/supabase/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { CampaignsService } from '@/lib/services/CampaignsService';

async function checkProStatus(userId: string) {
  const supabase = createAdminClient();
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('pro_active')
    .eq('user_id', userId)
    .single();

  return profile?.pro_active || false;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const campaignId = searchParams.get('campaignId');

    if (!campaignId) {
      return NextResponse.json({ error: 'Campaign ID required' }, { status: 400 });
    }

    // Get current user
    const cookieStore = await cookies();
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kfnsnwqylsdsbgnwgxva.supabase.co';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmbnNud3F5bHNkc2JnbndneHZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA5MjY3MzEsImV4cCI6MjA3NjUwMjczMX0.k2TZKPi3VxAVpEGggLiROYvfVu2nV_oSqBt2GM4jX-Y';
    const cleanUrl = supabaseUrl ? supabaseUrl.trim().replace(/\/$/, '') : 'https://kfnsnwqylsdsbgnwgxva.supabase.co';
    
    const supabase = createServerClient(
      cleanUrl,
      supabaseAnonKey,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if Pro (optional check for ZIP)
    const isPro = await checkProStatus(user.id);
    if (!isPro) {
      // You can choose to gate ZIP downloads
      // return NextResponse.json({ needsUpgrade: true }, { status: 402 });
    }

    const adminSupabase = createAdminClient();
    
    // Fetch campaign for metadata
    const campaign = await CampaignsService.fetchCampaign(campaignId);
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    // Fetch addresses with QR codes
    const { data: addresses } = await adminSupabase
      .from('campaign_addresses')
      .select('*')
      .eq('campaign_id', campaignId)
      .not('qr_png_url', 'is', null)
      .order('seq', { ascending: true, nullsFirst: false })
      .order('id', { ascending: true });

    if (!addresses || addresses.length === 0) {
      return NextResponse.json({ error: 'No QR codes found' }, { status: 404 });
    }

    // Fetch QR codes from qr_codes table to get short URLs
    const addressIds = addresses.map((a) => a.id);
    const { data: qrCodes } = await adminSupabase
      .from('qr_codes')
      .select('id, slug, qr_url, address_id')
      .in('address_id', addressIds);

    // Create a map of address_id -> qr_code for quick lookup
    const qrCodeMap = new Map(
      (qrCodes || []).map((qc) => [qc.address_id, qc])
    );

    const zip = new JSZip();

    for (const address of addresses) {
      try {
        // Extract the file path from the public URL
        const url = new URL(address.qr_png_url);
        const filePath = url.pathname.split('/storage/v1/object/public/qr/')[1];

        // Download from Supabase Storage
        const { data, error } = await adminSupabase.storage
          .from('qr')
          .download(filePath);

        if (error || !data) {
          console.error(`Error downloading ${filePath}:`, error);
          continue;
        }

        // Add to ZIP
        const addressLabel = (address.formatted || address.address || 'address').replace(/[^a-z0-9]/gi, '_');
        const fileName = `${addressLabel}_${address.id}.png`;
        zip.file(fileName, data);
      } catch (error) {
        console.error(`Error processing address ${address.id}:`, error);
      }
    }

    // Generate CSV manifest
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_BASE_URL || 'https://flyrpro.app';
    
    // Parse address components
    const parseAddress = (formatted: string) => {
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

    // Escape CSV values
    const escapeCsvValue = (value: string | null | undefined): string => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    // Generate CSV rows
    const csvHeaders = [
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

    const csvRows = addresses.map((address, index) => {
      const qrCode = qrCodeMap.get(address.id);
      
      // Use short slug URL if available, otherwise use legacy URL
      let qrUrl: string;
      if (qrCode?.qr_url) {
        qrUrl = qrCode.qr_url;
      } else if (qrCode?.slug) {
        qrUrl = `${baseUrl}/q/${qrCode.slug}`;
      } else {
        qrUrl = `${baseUrl}/api/open?addressId=${address.id}`;
      }

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

    const csvContent = [
      csvHeaders.join(','),
      ...csvRows.map((row) =>
        csvHeaders.map((header) => escapeCsvValue(row[header as keyof typeof row])).join(',')
      ),
    ].join('\n');

    // Add CSV manifest to ZIP
    zip.file('vdp-manifest.csv', csvContent);

    // Add README with printer instructions
    const readmeContent = `VDP (Variable Data Printing) Package for Campaign: ${campaign.name || campaignId}

This package contains:
1. PNG files: Individual QR code images for each address
2. vdp-manifest.csv: CSV file with address data and QR URLs for VDP software

For Professional Printers:
- Use the CSV file with your VDP software (XMPie, FusionPro, PrintShop Mail, etc.)
- The CSV contains all variable data needed for printing
- QR URLs are short slugs optimized for scanning (e.g., domain.com/q/a1b2c3d4)
- Each row represents one print piece

CSV Columns:
- reference_id: Unique identifier for tracking
- address_line, city, region, postal_code: Recipient address
- qr_url: QR code URL to embed in print piece
- campaign_id, campaign_name: Campaign metadata
- print_quantity: Number of copies (default: 1)

Instructions:
1. Import vdp-manifest.csv into your VDP software
2. Map the qr_url column to your QR code variable field
3. Map address fields to your address variable fields
4. Generate print-ready files with merged data

For questions or support, contact the campaign owner.
Generated: ${new Date().toISOString()}
`;

    zip.file('README.txt', readmeContent);

    const zipBlob = await zip.generateAsync({ type: 'blob' });

    return new NextResponse(zipBlob, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="campaign-${campaignId}-qr-codes.zip"`,
      },
    });
  } catch (error) {
    console.error('Error creating ZIP:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'ZIP creation failed' },
      { status: 500 }
    );
  }
}

