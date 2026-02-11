import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { gunzipSync } from 'zlib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

/**
 * GET /api/campaigns/[campaignId]/buildings
 * 
 * Returns building GeoJSON for a campaign.
 * Fetches fresh data from S3 (handles expired pre-signed URLs).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params;
  
  console.log(`[API] GET /campaigns/${campaignId}/buildings`);
  
  try {
    const supabase = createAdminClient();
    
    // Get campaign snapshot info
    const { data: snapshot, error: snapshotError } = await supabase
      .from('campaign_snapshots')
      .select('bucket, buildings_key, buildings_count')
      .eq('campaign_id', campaignId)
      .single();
    
    if (snapshotError || !snapshot?.buildings_key) {
      console.log('[API] No snapshot found, returning empty');
      return NextResponse.json({
        type: 'FeatureCollection',
        features: []
      });
    }
    
    console.log(`[API] Fetching from S3: ${snapshot.bucket}/${snapshot.buildings_key}`);
    
    // Fetch fresh from S3
    const command = new GetObjectCommand({
      Bucket: snapshot.bucket,
      Key: snapshot.buildings_key,
    });
    
    const response = await s3Client.send(command);
    const bodyBuffer = await response.Body?.transformToByteArray();
    
    if (!bodyBuffer) {
      throw new Error('Empty response from S3');
    }
    
    // Decompress gzip content
    const decompressed = gunzipSync(Buffer.from(bodyBuffer));
    const geojson = JSON.parse(decompressed.toString('utf-8'));
    
    console.log(`[API] Returning ${geojson.features?.length || 0} buildings`);
    
    return NextResponse.json(geojson);
    
  } catch (error) {
    console.error('[API] Error fetching buildings:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch buildings' },
      { status: 500 }
    );
  }
}
