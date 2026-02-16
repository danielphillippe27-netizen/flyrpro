#!/usr/bin/env tsx
/**
 * Load parcels from S3 into Supabase for a specific campaign
 * Filters parcels by campaign bbox before inserting
 * 
 * Usage:
 *   export AWS_ACCESS_KEY_ID=xxx
 *   export AWS_SECRET_ACCESS_KEY=xxx
 *   export SUPABASE_SERVICE_ROLE_KEY=xxx
 *   npx tsx scripts/load-parcels-for-campaign.ts <campaign-id>
 * 
 * Or with manual bbox:
 *   npx tsx scripts/load-parcels-for-campaign.ts <campaign-id> "-79.65,43.65,-79.55,43.75"
 */
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
import { feature, featureCollection, bbox as turfBbox } from '@turf/turf';

const BUCKET_NAME = 'flyr-pro-addresses-2025';
const S3_KEY = 'parcels/toronto/toronto_parcels.geojson';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://kfnsnwqylsdsbgnwgxva.supabase.co';

async function loadParcelsForCampaign() {
  const campaignId = process.argv[2];
  const manualBbox = process.argv[3]; // Optional: "minLon,minLat,maxLon,maxLat"
  
  if (!campaignId) {
    console.error('Usage: npx tsx scripts/load-parcels-for-campaign.ts <campaign-id> [bbox]');
    console.error('Example: npx tsx scripts/load-parcels-for-campaign.ts 60500756-3246-41a9-b1e4-37ac994b11fc');
    process.exit(1);
  }
  
  console.log(`=== Loading Parcels for Campaign: ${campaignId} ===\n`);
  
  // Initialize clients
  const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
  const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  
  // Get campaign bbox
  let bbox: number[];
  if (manualBbox) {
    bbox = manualBbox.split(',').map(Number);
    console.log(`Using manual bbox: ${bbox.join(', ')}`);
  } else {
    console.log('Fetching campaign bbox from database...');
    const { data: campaign, error } = await supabase
      .from('campaigns')
      .select('bbox, territory_boundary')
      .eq('id', campaignId)
      .single();
    
    if (error || !campaign) {
      console.error('❌ Campaign not found:', error);
      process.exit(1);
    }
    
    if (campaign.bbox) {
      bbox = campaign.bbox;
    } else if (campaign.territory_boundary) {
      // Calculate bbox from polygon
      const poly = feature(campaign.territory_boundary);
      bbox = turfBbox(poly);
    } else {
      console.error('❌ Campaign has no bbox or territory_boundary');
      process.exit(1);
    }
    console.log(`Campaign bbox: ${bbox.join(', ')}`);
  }
  
  const [minLon, minLat, maxLon, maxLat] = bbox;
  
  // Download parcels from S3
  console.log('\nDownloading parcels from S3...');
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: S3_KEY
  });
  
  const response = await s3Client.send(command);
  const bodyContents = await response.Body?.transformToString();
  
  if (!bodyContents) {
    console.error('❌ Failed to download parcels');
    process.exit(1);
  }
  
  console.log('Parsing GeoJSON...');
  const allParcels = JSON.parse(bodyContents);
  console.log(`Total parcels in file: ${allParcels.features.length}`);
  
  // Filter parcels by bbox
  console.log('Filtering parcels by campaign bbox...');
  const filteredFeatures = allParcels.features.filter((f: any) => {
    // Simple bbox check using the first coordinate of the polygon
    const coords = f.geometry.coordinates[0][0];
    const lon = coords[0];
    const lat = coords[1];
    return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
  });
  
  console.log(`Parcels in campaign area: ${filteredFeatures.length}`);
  
  if (filteredFeatures.length === 0) {
    console.log('⚠️ No parcels found in campaign area');
    return;
  }
  
  // Prepare for insert
  const parcelsToInsert = filteredFeatures.map((f: any) => ({
    campaign_id: campaignId,
    external_id: f.properties.PARCELID,
    geom: JSON.stringify(f.geometry),
    properties: f.properties
  }));
  
  // Insert in batches
  console.log('\nInserting parcels into Supabase...');
  const BATCH_SIZE = 500;
  let inserted = 0;
  
  for (let i = 0; i < parcelsToInsert.length; i += BATCH_SIZE) {
    const batch = parcelsToInsert.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from('campaign_parcels')
      .insert(batch);
    
    if (error) {
      console.error(`❌ Batch insert failed at ${i}:`, error);
      continue;
    }
    
    inserted += batch.length;
    process.stdout.write(`\rProgress: ${inserted}/${parcelsToInsert.length}`);
  }
  
  console.log(`\n\n✅ Successfully inserted ${inserted} parcels!`);
  console.log('\nNext steps:');
  console.log(`1. Run linker: SELECT link_campaign_data('${campaignId}');`);
  console.log('2. Check results: parcel_count should be > 0');
}

loadParcelsForCampaign().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
