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
 * - Gold: Fetches from ref_buildings_gold via campaign_addresses.building_id
 * - Silver: Fetches from S3 snapshot
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params;
  
  console.log(`[API] GET /campaigns/${campaignId}/buildings`);
  
  try {
    const supabase = createAdminClient();
    
    // First, check if campaign has Gold-linked buildings
    const { data: goldBuildings, error: goldError } = await supabase
      .from('campaign_addresses')
      .select('building_id')
      .eq('campaign_id', campaignId)
      .not('building_id', 'is', null)
      .limit(1);
    
    if (goldError) {
      console.error('[API] Error checking Gold buildings:', goldError.message);
    }
    
    // GOLD PATH: Return linked Gold buildings
    if (goldBuildings && goldBuildings.length > 0) {
      console.log('[API] Using Gold Standard buildings');
      
      const { data: buildings, error: buildingsError } = await supabase.rpc(
        'get_campaign_buildings_geojson',
        { p_campaign_id: campaignId }
      );
      
      if (buildingsError) {
        console.error('[API] Gold RPC error:', buildingsError.message);
        // Fall through to S3 attempt
      } else if (buildings) {
        console.log(`[API] Returning ${buildings.features?.length || 0} Gold buildings`);
        return NextResponse.json(buildings);
      }
    }
    
    // SILVER PATH: Fetch from S3 snapshot
    const { data: snapshot, error: snapshotError } = await supabase
      .from('campaign_snapshots')
      .select('bucket, buildings_key, buildings_count')
      .eq('campaign_id', campaignId)
      .maybeSingle();
    
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
    
    console.log(`[API] Returning ${geojson.features?.length || 0} buildings from S3`);
    
    return NextResponse.json(geojson);
    
  } catch (error) {
    console.error('[API] Error fetching buildings:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch buildings' },
      { status: 500 }
    );
  }
}
