/**
 * Canva Bulk QR Generator - Server-Side Endpoint
 * 
 * POST /api/canva/generate
 * 
 * Generates QR codes for Canva Bulk Create, uploads to S3, persists to DB,
 * and returns a downloadable CSV with ImageURL column.
 * 
 * Body: {
 *   campaignId: string,
 *   baseUrl: string,
 *   rows: Array<{
 *     AddressLine: string,
 *     City: string,
 *     Province: string,
 *     PostalCode: string,
 *     ImageFilename?: string,
 *     ...other fields
 *   }>
 * }
 * 
 * Returns: CSV file download with added columns (ImageURL, EncodedURL, S3Key)
 */

import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { stringify } from 'csv-stringify/sync';
import { createAdminClient } from '@/lib/supabase/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  awsRegion: process.env.AWS_REGION || 'us-east-2',
  s3Bucket: process.env.S3_BUCKET || 'qr-csv-flyr',
  qrPrefix: 'qr/',
  maxConcurrency: 5, // Process 5 rows at a time to avoid timeouts
};

// ============================================================================
// Types
// ============================================================================

interface CanvaRow {
  AddressLine: string;
  City: string;
  Province: string;
  PostalCode: string;
  ImageFilename?: string;
  [key: string]: string | undefined;
}

interface ProcessedRow extends CanvaRow {
  ImageURL: string;
  EncodedURL: string;
  S3Key: string;
  Error?: string;
}

interface ProcessResult {
  row: number;
  filename: string;
  s3Key: string;
  publicUrl: string;
  encodedUrl: string;
  status: 'uploaded' | 'exists' | 'failed';
  error?: string;
}

// ============================================================================
// S3 Client
// ============================================================================

const s3Client = new S3Client({
  region: CONFIG.awsRegion,
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Sanitize filename for S3 key
 * Allow only [a-zA-Z0-9._-], replace spaces with "-", collapse repeats
 */
function sanitizeFilename(str: string): string {
  return str
    .trim()
    .replace(/[^a-zA-Z0-9._\s-]/g, '') // Remove special chars
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/\.{2,}/g, '.') // Collapse multiple dots
    .substring(0, 200); // Limit length
}

/**
 * Generate filename from row data or use provided ImageFilename
 */
function generateFilename(row: CanvaRow, index: number): string {
  // Use existing ImageFilename if present
  if (row.ImageFilename) {
    return row.ImageFilename.endsWith('.png') 
      ? row.ImageFilename 
      : `${row.ImageFilename}.png`;
  }

  // Build from address components
  const addressLine = sanitizeFilename(row.AddressLine || '');
  const city = sanitizeFilename(row.City || '');
  const province = sanitizeFilename(row.Province || '');
  const postalCode = sanitizeFilename(row.PostalCode || '');

  if (!addressLine) {
    return `qr-${index + 1}.png`;
  }

  return `${addressLine}-${city}-${province}-${postalCode}.png`;
}

/**
 * Build S3 key with user and campaign prefix
 */
function buildS3Key(userId: string, campaignId: string, filename: string): string {
  return `${CONFIG.qrPrefix}${userId}/${campaignId}/${filename}`;
}

/**
 * Build public S3 URL
 */
function buildPublicUrl(s3Key: string): string {
  return `https://${CONFIG.s3Bucket}.s3.${CONFIG.awsRegion}.amazonaws.com/${s3Key}`;
}

/**
 * Check if object already exists in S3
 */
async function checkObjectExists(s3Key: string): Promise<boolean> {
  try {
    await s3Client.send(
      new HeadObjectCommand({
        Bucket: CONFIG.s3Bucket,
        Key: s3Key,
      })
    );
    return true;
  } catch (error: any) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw error;
  }
}

/**
 * Generate QR code PNG buffer
 */
async function generateQRBuffer(url: string): Promise<Buffer> {
  return QRCode.toBuffer(url, {
    type: 'png',
    width: 512,
    margin: 2,
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  });
}

/**
 * Upload QR to S3 (no ACL - relies on bucket policy)
 */
async function uploadToS3(
  s3Key: string,
  buffer: Buffer,
  skipIfExists: boolean
): Promise<{ uploaded: boolean; url: string }> {
  // Check if exists
  if (skipIfExists) {
    const exists = await checkObjectExists(s3Key);
    if (exists) {
      console.log(`[CanvaQR] Object exists, skipping: ${s3Key}`);
      return { uploaded: false, url: buildPublicUrl(s3Key) };
    }
  }

  // Upload without ACL (bucket policy handles public access)
  await s3Client.send(
    new PutObjectCommand({
      Bucket: CONFIG.s3Bucket,
      Key: s3Key,
      Body: buffer,
      ContentType: 'image/png',
      CacheControl: 'public, max-age=31536000, immutable',
      // Note: No ACL specified - bucket has Object Ownership enforced
    })
  );

  return { uploaded: true, url: buildPublicUrl(s3Key) };
}

/**
 * Persist QR asset to database
 */
async function persistQRAsset(
  supabase: ReturnType<typeof createAdminClient>,
  params: {
    userId: string;
    campaignId: string;
    addressData: CanvaRow;
    filename: string;
    s3Key: string;
    publicUrl: string;
    encodedUrl: string;
  }
): Promise<void> {
  // Use campaign_addresses table with canva-specific columns
  // Store the S3 reference in a JSONB field or dedicated columns
  const { error } = await supabase
    .from('campaign_addresses')
    .upsert({
      campaign_id: params.campaignId,
      // Build formatted address from components
      formatted: [
        params.addressData.AddressLine,
        params.addressData.City,
        params.addressData.Province,
        params.addressData.PostalCode,
      ].filter(Boolean).join(', '),
      address: params.addressData.AddressLine,
      // Store Canva QR metadata in metadata JSONB
      metadata: {
        canva_qr: {
          filename: params.filename,
          s3_key: params.s3Key,
          public_url: params.publicUrl,
          encoded_url: params.encodedUrl,
          generated_at: new Date().toISOString(),
        },
      },
      // Set source to identify Canva bulk entries
      source: 'canva_bulk',
      visited: false,
    }, {
      onConflict: 'campaign_id,address', // Upsert by campaign + address
    });

  if (error) {
    console.error('[CanvaQR] DB persist error:', error);
    // Don't throw - we can still return the CSV even if DB storage fails
  }
}

/**
 * Process a single row with full error handling
 */
async function processRow(
  row: CanvaRow,
  index: number,
  userId: string,
  campaignId: string,
  baseUrl: string,
  skipExisting: boolean
): Promise<ProcessResult> {
  const rowNum = index + 1;
  
  try {
    // Generate filename
    const filename = generateFilename(row, index);
    const s3Key = buildS3Key(userId, campaignId, filename);
    
    console.log(`[CanvaQR] [${rowNum}] Processing: ${filename}`);

    // Build encoded URL with tracking params
    const encodedUrl = new URL(baseUrl);
    encodedUrl.searchParams.set('campaignId', campaignId);
    encodedUrl.searchParams.set('address', row.AddressLine);
    encodedUrl.searchParams.set('city', row.City);
    encodedUrl.searchParams.set('province', row.Province);
    encodedUrl.searchParams.set('postalCode', row.PostalCode);
    encodedUrl.searchParams.set('source', 'canva');
    
    const encodedUrlString = encodedUrl.toString();

    // Generate QR buffer
    const qrBuffer = await generateQRBuffer(encodedUrlString);

    // Upload to S3
    const { uploaded, url: publicUrl } = await uploadToS3(s3Key, qrBuffer, skipExisting);

    // Persist to DB (fire and forget - don't await for speed)
    const supabase = createAdminClient();
    persistQRAsset(supabase, {
      userId,
      campaignId,
      addressData: row,
      filename,
      s3Key,
      publicUrl,
      encodedUrl: encodedUrlString,
    }).catch((err) => {
      console.error(`[CanvaQR] [${rowNum}] DB persist failed:`, err);
    });

    console.log(`[CanvaQR] [${rowNum}] ${uploaded ? 'Uploaded' : 'Exists'}: ${publicUrl}`);

    return {
      row: rowNum,
      filename,
      s3Key,
      publicUrl,
      encodedUrl: encodedUrlString,
      status: uploaded ? 'uploaded' : 'exists',
    };
  } catch (error: any) {
    console.error(`[CanvaQR] [${rowNum}] Error:`, error.message);
    return {
      row: rowNum,
      filename: generateFilename(row, index),
      s3Key: '',
      publicUrl: '',
      encodedUrl: '',
      status: 'failed',
      error: error.message,
    };
  }
}

/**
 * Process rows with limited concurrency
 */
async function processRowsWithConcurrency<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = [];
  
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((item, batchIndex) => processor(item, i + batchIndex))
    );
    results.push(...batchResults);
  }
  
  return results;
}

// ============================================================================
// Main Handler
// ============================================================================

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    // ---------------------------------------------------------------------
    // 1. AUTHENTICATION
    // ---------------------------------------------------------------------
    const supabase = getSupabaseServerClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized. Please log in.' },
        { status: 401 }
      );
    }
    
    const userId = user.id;

    // ---------------------------------------------------------------------
    // 2. PARSE REQUEST BODY
    // ---------------------------------------------------------------------
    const body = await request.json();
    const { campaignId, baseUrl, rows } = body;

    if (!campaignId) {
      return NextResponse.json(
        { error: 'campaignId is required' },
        { status: 400 }
      );
    }

    if (!baseUrl) {
      return NextResponse.json(
        { error: 'baseUrl is required' },
        { status: 400 }
      );
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json(
        { error: 'rows must be a non-empty array' },
        { status: 400 }
      );
    }

    // Limit rows for safety (prevent timeouts)
    const MAX_ROWS = 300;
    const limitedRows = rows.slice(0, MAX_ROWS);
    if (rows.length > MAX_ROWS) {
      console.warn(`[CanvaQR] Truncated ${rows.length} rows to ${MAX_ROWS}`);
    }

    console.log(`[CanvaQR] Starting generation for ${limitedRows.length} rows, campaign: ${campaignId}, user: ${userId}`);

    // ---------------------------------------------------------------------
    // 3. PROCESS ROWS WITH CONCURRENCY LIMIT
    // ---------------------------------------------------------------------
    const results = await processRowsWithConcurrency(
      limitedRows,
      (row, index) => processRow(row, index, userId, campaignId, baseUrl, true),
      CONFIG.maxConcurrency
    );

    // ---------------------------------------------------------------------
    // 4. BUILD OUTPUT CSV
    // ---------------------------------------------------------------------
    const outputRows: ProcessedRow[] = limitedRows.map((row, index) => {
      const result = results[index];
      return {
        ...row,
        ImageURL: result.publicUrl || '',
        EncodedURL: result.encodedUrl || '',
        S3Key: result.s3Key || '',
        Error: result.error || '',
      };
    });

    const csvContent = stringify(outputRows, {
      header: true,
      columns: [
        // Original columns first
        'AddressLine',
        'City',
        'Province',
        'PostalCode',
        'ImageFilename',
        // Add any other original columns dynamically
        ...Object.keys(limitedRows[0] || {}).filter(
          (key) => !['AddressLine', 'City', 'Province', 'PostalCode', 'ImageFilename'].includes(key)
        ),
        // New columns at end
        'EncodedURL',
        'S3Key',
        'ImageURL',
        'Error',
      ],
    });

    // ---------------------------------------------------------------------
    // 5. LOGGING & METRICS
    // ---------------------------------------------------------------------
    const uploaded = results.filter((r) => r.status === 'uploaded').length;
    const existing = results.filter((r) => r.status === 'exists').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    const duration = Date.now() - startTime;

    console.log(`[CanvaQR] Complete: ${uploaded} uploaded, ${existing} existing, ${failed} failed, ${duration}ms`);

    // ---------------------------------------------------------------------
    // 6. RETURN CSV DOWNLOAD
    // ---------------------------------------------------------------------
    const sanitizedCampaignId = campaignId.replace(/[^a-zA-Z0-9_-]/g, '');
    const filename = `canva_bulk_${sanitizedCampaignId}.csv`;

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Canva-Total': String(results.length),
        'X-Canva-Uploaded': String(uploaded),
        'X-Canva-Existing': String(existing),
        'X-Canva-Failed': String(failed),
      },
    });

  } catch (error: any) {
    console.error('[CanvaQR] Fatal error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
