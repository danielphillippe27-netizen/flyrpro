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

function hasPolygonFeatures(featureCollection: unknown): boolean {
  if (!featureCollection || typeof featureCollection !== 'object') return false;
  const features = (featureCollection as { features?: unknown }).features;
  if (!Array.isArray(features)) return false;

  return features.some((feature) => {
    if (!feature || typeof feature !== 'object') return false;
    const geometry = (feature as { geometry?: { type?: unknown } }).geometry;
    const type = geometry?.type;
    return type === 'Polygon' || type === 'MultiPolygon';
  });
}

/**
 * GET /api/campaigns/[campaignId]/buildings
 * 
 * Returns building GeoJSON for a campaign.
 * - Gold: Direct spatial query of ref_buildings_gold (no linking required)
 * - Silver: Fetch from S3 snapshot
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const { campaignId } = await params;
  
  console.log(`[API] GET /campaigns/${campaignId}/buildings`);
  
  try {
    const supabase = createAdminClient();
    
    // UNIFIED PATH: Use consolidated RPC that handles both Gold and Silver buildings
    // Gold: campaign_addresses.building_id → ref_buildings_gold (polygon features)
    // Silver: building_address_links → buildings table (polygon features)
    // Fallback: address points (when no building polygons are linked)
    console.log('[API] Fetching campaign features via rpc_get_campaign_full_features');
    
    const { data: campaignFeatures, error: featuresError } = await supabase.rpc(
      'rpc_get_campaign_full_features',
      { p_campaign_id: campaignId }
    );
    let fallbackFeatures = campaignFeatures ?? null;

    if (!featuresError && campaignFeatures && campaignFeatures.features?.length > 0) {
      if (hasPolygonFeatures(campaignFeatures)) {
        console.log(
          `[API] Returning ${campaignFeatures.features.length} polygon features ` +
            `(source: ${campaignFeatures.features[0]?.properties?.source || 'unknown'})`
        );
        return NextResponse.json(campaignFeatures);
      }

      console.log('[API] RPC returned point-only features; attempting link repair before fallback');
    } else if (featuresError) {
      console.error('[API] Feature RPC error:', featuresError.message);
    } else {
      console.log('[API] No linked features from RPC');
    }

    // Self-heal: relink on demand for campaigns that have addresses but no polygon links yet.
    // This handles mixed DB states where the provision step may have skipped linker RPCs.
    let repairAttempted = false;
    const { data: campaignRow } = await supabase
      .from('campaigns')
      .select('territory_boundary')
      .eq('id', campaignId)
      .maybeSingle();

    if (campaignRow?.territory_boundary) {
      const { error: goldRepairError } = await supabase.rpc('link_campaign_addresses_gold', {
        p_campaign_id: campaignId,
        p_polygon_geojson: campaignRow.territory_boundary,
      });

      if (goldRepairError) {
        console.warn('[API] Gold link repair failed (continuing):', goldRepairError.message);
      } else {
        repairAttempted = true;
      }
    }

    const { data: allRepairData, error: allRepairError } = await supabase.rpc(
      'link_campaign_addresses_all',
      { p_campaign_id: campaignId }
    );

    if (allRepairError) {
      console.warn('[API] Consolidated link repair failed (continuing):', allRepairError.message);
    } else {
      repairAttempted = true;
      const row = Array.isArray(allRepairData) ? allRepairData[0] : allRepairData;
      console.log('[API] Consolidated link repair result:', row ?? 'ok');
    }

    if (repairAttempted) {
      const { data: repairedFeatures, error: repairedError } = await supabase.rpc(
        'rpc_get_campaign_full_features',
        { p_campaign_id: campaignId }
      );

      if (!repairedError && repairedFeatures && repairedFeatures.features?.length > 0) {
        fallbackFeatures = repairedFeatures;
        if (hasPolygonFeatures(repairedFeatures)) {
          console.log(`[API] Returning ${repairedFeatures.features.length} polygon features after repair`);
          return NextResponse.json(repairedFeatures);
        }
      } else if (repairedError) {
        console.warn('[API] Feature RPC after repair failed:', repairedError.message);
      }
    }
    
    // SNAPSHOT PATH: Fetch from S3 snapshot when RPC is point-only or empty
    console.log('[API] Trying buildings from S3 snapshot');
    
    const { data: snapshot, error: snapshotError } = await supabase
      .from('campaign_snapshots')
      .select('bucket, buildings_key, buildings_count')
      .eq('campaign_id', campaignId)
      .maybeSingle();
    
    if (snapshotError || !snapshot?.buildings_key) {
      if (fallbackFeatures?.features?.length > 0) {
        console.log(`[API] No snapshot found, returning ${fallbackFeatures.features.length} point features`);
        return NextResponse.json(fallbackFeatures);
      }

      console.log('[API] No snapshot found, returning empty');
      return NextResponse.json({ type: 'FeatureCollection', features: [] });
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
    
    console.log(`[API] Returning ${geojson.features?.length || 0} Silver buildings from S3`);
    
    return NextResponse.json(geojson);
    
  } catch (error) {
    console.error('[API] Error fetching buildings:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch buildings' },
      { status: 500 }
    );
  }
}
