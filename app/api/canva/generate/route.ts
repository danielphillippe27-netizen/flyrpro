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
import JSZip from 'jszip';

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
  QRBase64: string;
  QRImage: string; // Local path for Affinity/Illustrator
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
  qrBuffer?: Buffer; // For including in ZIP
  qrBase64?: string; // For CSV embedding
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
 * Generate a source_id for Canva address entries
 * Creates a unique identifier based on address components
 */
function generateAddressSourceId(addressData: CanvaRow): string {
  const components = [
    addressData.AddressLine,
    addressData.City,
    addressData.Province,
    addressData.PostalCode,
  ].filter(Boolean).join('-').toLowerCase();
  
  // Sanitize: replace non-alphanumeric with dash, collapse multiple dashes
  return components
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 200);
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
): Promise<string | null> {
  // Generate unique source_id for this address
  const sourceId = generateAddressSourceId(params.addressData);
  
  // Build formatted address from components (this goes into the 'formatted' column)
  const formattedAddress = [
    params.addressData.AddressLine,
    params.addressData.City,
    params.addressData.Province,
    params.addressData.PostalCode,
  ].filter(Boolean).join(', ');
  
  // Extract house number and street name from address line
  const houseNum = params.addressData.AddressLine.match(/^\d+/)?.[0] || null;
  const streetName = params.addressData.AddressLine.replace(/^\d+\s*/, '').trim();
  
  const { data, error } = await supabase
    .from('campaign_addresses')
    .upsert({
      campaign_id: params.campaignId,
      formatted: formattedAddress,
      postal_code: params.addressData.PostalCode,
      house_number: houseNum,
      street_name: streetName,
      // Set source and source_id for unique constraint
      source: 'canva_bulk',
      source_id: sourceId,
      visited: false,
    }, {
      onConflict: 'campaign_id,source_id', // Unique constraint columns
    })
    .select('id')
    .single();

  if (error) {
    console.error('[CanvaQR] DB persist error:', error);
    // Don't throw - we can still return the CSV even if DB storage fails
    return null;
  }

  console.log('[CanvaQR] Persisted address with ID:', data?.id);
  return data?.id || null;
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

    // FIRST: Persist to DB to get the actual address ID
    const supabase = createAdminClient();
    const addressId = await persistQRAsset(supabase, {
      userId,
      campaignId,
      addressData: row,
      filename,
      s3Key,
      publicUrl: '', // Will update after S3 upload
      encodedUrl: '', // Will update after we have the URL
    });

    if (!addressId) {
      throw new Error('Failed to create or find address in database');
    }

    console.log(`[CanvaQR] [${rowNum}] Address ID: ${addressId}`);

    // Build encoded URL WITH the actual address ID for proper tracking
    const encodedUrl = new URL(baseUrl);
    encodedUrl.searchParams.set('id', addressId); // Use actual DB ID for tracking
    encodedUrl.searchParams.set('campaignId', campaignId);
    encodedUrl.searchParams.set('address', row.AddressLine);
    
    const encodedUrlString = encodedUrl.toString();

    // Generate QR buffer
    const qrBuffer = await generateQRBuffer(encodedUrlString);

    // Upload to S3
    const { uploaded, url: publicUrl } = await uploadToS3(s3Key, qrBuffer, skipExisting);

    // Update the address record with the final URL
    await supabase
      .from('campaign_addresses')
      .update({ 
        purl: encodedUrlString,
      })
      .eq('id', addressId);

    console.log(`[CanvaQR] [${rowNum}] ${uploaded ? 'Uploaded' : 'Exists'}: ${publicUrl}`);

    // Generate base64 for CSV embedding
    const qrBase64 = qrBuffer.toString('base64');

    return {
      row: rowNum,
      filename,
      s3Key,
      publicUrl,
      encodedUrl: encodedUrlString,
      status: uploaded ? 'uploaded' : 'exists',
      qrBuffer, // Include buffer for ZIP
      qrBase64, // Include base64 for CSV
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
 * Generate README content with Canva instructions
 */
function generateReadme(
  campaignId: string,
  total: number,
  uploaded: number,
  existing: number,
  failed: number
): string {
  return `================================================================================
FLYR PRO - CANVA BULK QR CODE PACKAGE
================================================================================

Campaign ID: ${campaignId}
Generated: ${new Date().toLocaleString()}

SUMMARY
-------
Total QRs:     ${total}
New uploads:   ${uploaded}
Already existed: ${existing}
Failed:        ${failed}

WHAT'S IN THIS ZIP
------------------
1. canva_bulk_${campaignId}.csv  - Import this into Canva Bulk Create
2. qr-images/                    - Folder with all QR code PNG files
3. README.txt                    - This file

CSV COLUMNS EXPLAINED
---------------------
- AddressLine, City, Province, PostalCode: Address data for text fields
- ImageFilename: Name of the QR image file (in qr-images/ folder)
- ImageURL: Public S3 URL (use this for images in Canva)
- EncodedURL: The scan tracking URL embedded in each QR
- QRImage: Relative path to QR file (qr-images/filename.png) for Affinity/Illustrator
- QRBase64: QR image as base64 text (for custom integrations)
- S3Key: Internal AWS S3 path
- Error: Any errors during generation (empty if successful)

HOW TO USE WITH CANVA BULK CREATE
----------------------------------

Step 1: Open Canva Bulk Create
  - Go to canva.com and create a new design (flyer, postcard, etc.)
  - Click "Apps" in the left sidebar
  - Search for and open "Bulk Create"

Step 2: Upload the CSV
  - In Bulk Create, click "Upload CSV"
  - Select: canva_bulk_${campaignId}.csv
  - Canva will read the columns automatically

Step 1: Upload QR images to Canva (REQUIRED)
  - Go to canva.com and open your design
  - Go to the "Uploads" tab (left sidebar)
  - Click "Upload files"
  - Select ALL the PNG files from the qr-images/ folder in this ZIP
  - Wait for all uploads to complete

Step 2: Open Bulk Create
  - Click "Apps" in the left sidebar
  - Search for and open "Bulk Create"

Step 3: Upload the CSV
  - In Bulk Create, click "Upload CSV"
  - Select: canva_bulk_${campaignId}.csv

Step 4: Connect Data to Your Design
  - For TEXT elements (address, city, etc.):
    * Click on a text box in your design
    * In Bulk Create, click the field name (<<AddressLine>>, <<City>>, etc.)
  
  - For the QR CODE image:
    * Add an "Image Frame" to your design (Elements > Frames)
    * Click the frame to select it
    * In Bulk Create, connect the "ImageFilename" column
    * Canva will match the filenames to your uploaded images

Step 5: Generate designs
  - Click "Generate" 
  - Canva will create one page per row with the matching QR code

IMPORTANT: Canva cannot use external URLs (ImageURL column). You MUST upload
the PNG files to Canva first, then match by filename using ImageFilename column.

ALTERNATIVE: Using QRBase64 (Not for Canva)
--------------------------------------------
The CSV includes a "QRBase64" column with QR images as base64 text.
This is useful for custom integrations but NOT supported by Canva.
Use the qr-images/ folder + ImageFilename column for Canva instead.

================================================================================
AFFINITY PUBLISHER / DESIGNER - DATA MERGE
================================================================================

Step 1: Extract the ZIP file
  - Extract to a folder on your computer (e.g., Desktop/FLYR_QR/)
  - Keep the CSV and qr-images/ folder together

Step 2: Update file paths (IMPORTANT)
  - Open the CSV in Excel or a text editor
  - Find the "QRImage" column
  - Replace "qr-images/" with the FULL path to your extracted folder
  
  Example (Mac):
  Before: qr-images/602-DOWN-CRES-OSHAWA-ON-L1H8K4.png
  After:  /Users/daniel/Desktop/FLYR_QR/qr-images/602-DOWN-CRES-OSHAWA-ON-L1H8K4.png
  
  Example (Windows):
  Before: qr-images/602-DOWN-CRES-OSHAWA-ON-L1H8K4.png
  After:  C:\\Users\\Daniel\\Desktop\\FLYR_QR\\qr-images\\602-DOWN-CRES-OSHAWA-ON-L1H8K4.png
  
  Save the CSV.

Step 3: Build your template in Affinity Publisher
  - Create your flyer layout
  - Add text boxes for AddressLine, City, Province, PostalCode
  - Add an image frame for the QR code (File → Place any QR png as placeholder)

Step 4: Connect the data source
  - Window → Data Merge Manager
  - Click "Add Data Source" → select your CSV
  - You'll see all columns listed

Step 5: Connect text fields
  - Click a text box
  - In Data Merge Manager, click the field name (<<AddressLine>>, <<City>>, etc.)

Step 6: Connect the QR image
  - Click your QR image frame
  - In Data Merge Manager, click "QRImage" field
  - Choose "Insert as Image" (right-click menu)

Step 7: Generate
  - Click "Generate" or "Create Merged Document"
  - Choose "All records"
  - Affinity will create one page per row with the correct QR image

TROUBLESHOOTING (Affinity)
--------------------------
"Image not found" error?
  - Make sure you updated the QRImage column with FULL file paths
  - Check that PNG files actually exist at those locations
  - Avoid spaces and special characters in folder paths

QR not fitting the frame?
  - Select the image frame → set scaling to "Fit" or "Fill"

Using Affinity Designer instead of Publisher?
  - Designer has limited data merge. Use Publisher for bulk pages.
  - Or use the Canva workflow instead (export to PDF from Canva).

QR CODE TRACKING
----------------
Each QR code contains a unique tracking URL that records:
- When the QR was scanned
- Which address/campaign it belongs to
- The user's location (if permitted)

Tracking URL format:
https://www.flyrpro.app/api/scan?campaignId=${campaignId}&address=...

Scan data will appear in your FLYR Pro campaign dashboard.

TROUBLESHOOTING
---------------

QR images not loading in Canva?
  - The images are hosted on AWS S3 and are publicly accessible
  - Check your internet connection
  - Try refreshing the Canva page

CSV upload fails?
  - Make sure you're using the exact file: canva_bulk_${campaignId}.csv
  - Don't rename or edit the CSV before uploading

Wrong data showing up?
  - Check that you've connected the correct columns to the right elements
  - AddressLine = street address
  - City = city name
  - Province = province/state
  - PostalCode = postal/zip code

NEED HELP?
----------
Contact FLYR Pro support or visit your campaign dashboard at:
https://www.flyrpro.app/campaigns/${campaignId}

================================================================================
Generated by FLYR Pro - Smart Marketing for Real Estate
================================================================================
`;
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
    const supabase = await getSupabaseServerClient();
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
      const filename = result.filename || generateFilename(row, index);
      return {
        ...row,
        ImageURL: result.publicUrl || '',
        EncodedURL: result.encodedUrl || '',
        S3Key: result.s3Key || '',
        QRBase64: result.qrBase64 || '',
        QRImage: `qr-images/${filename}`, // Relative path for Affinity/Illustrator
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
        'QRImage',
        'QRBase64',
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
    // 6. BUILD ZIP WITH CSV, README, AND QR IMAGES
    // ---------------------------------------------------------------------
    const sanitizedCampaignId = campaignId.replace(/[^a-zA-Z0-9_-]/g, '');
    const zip = new JSZip();

    // Add CSV to ZIP
    zip.file(`canva_bulk_${sanitizedCampaignId}.csv`, csvContent);

    // Add QR images folder
    const qrFolder = zip.folder('qr-images');
    for (const result of results) {
      if (result.qrBuffer && result.filename) {
        qrFolder?.file(result.filename, result.qrBuffer);
      }
    }

    // Add README with instructions
    const readmeContent = generateReadme(sanitizedCampaignId, results.length, uploaded, existing, failed);
    zip.file('README.txt', readmeContent);

    // Generate ZIP buffer
    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });

    // ---------------------------------------------------------------------
    // 7. RETURN ZIP DOWNLOAD
    // ---------------------------------------------------------------------
    return new NextResponse(zipBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="canva_qr_${sanitizedCampaignId}.zip"`,
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
