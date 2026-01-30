import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { OvertureService } from '@/lib/services/OvertureService';
import { MapService } from '@/lib/services/MapService';
import { mapOvertureToCanonical } from '@/lib/geo/overtureToCanonical';
import type { CanonicalCampaignAddress } from '@/lib/geo/types';

// FIX: Ensure Node.js runtime (MotherDuck/DuckDB requires Node, not Edge)
export const runtime = 'nodejs';

interface GenerateAddressListRequest {
  campaign_id: string;
  starting_address?: string;
  count?: number;
  coordinates?: {
    lat: number;
    lng: number;
  };
  polygon?: {
    type: 'Polygon';
    coordinates: number[][][];
  };
}

export async function POST(request: NextRequest) {
  console.log('--- DEBUG START ---');
  
  // 1. DEBUG TOKEN
  const token = process.env.MOTHERDUCK_TOKEN;
  if (token) {
    console.log(`Token Status: FOUND`);
    console.log(`Token Length: ${token.length}`);
    console.log(`Token Start: ${token.substring(0, 10)}...`);
    console.log(`Token End: ...${token.substring(token.length - 10)}`);
    // Check for accidental quotes
    if (token.startsWith('"') || token.startsWith("'")) {
      console.error('CRITICAL ERROR: Token has invalid quotes in .env file!');
    }
    // Check for whitespace
    if (token.trim().length !== token.length) {
      console.error('CRITICAL ERROR: Token has hidden spaces!');
    }
  } else {
    console.log('Token Status: NOT FOUND (Using Local DuckDB)');
  }

  console.log('--- Starting Address Generation ---');
  
  try {
    const body: GenerateAddressListRequest = await request.json();
    const { campaign_id, starting_address, count = 50, coordinates: providedCoordinates, polygon } = body;

    // Validate input
    if (!campaign_id) return NextResponse.json({ error: 'campaign_id is required' }, { status: 400 });
    
    // Either starting_address (for closest_home/same_street) or polygon (for map territory) is required
    if (!starting_address && !polygon) {
      return NextResponse.json({ error: 'Either starting_address or polygon is required' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // Validate campaign exists
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('owner_id')
      .eq('id', campaign_id)
      .single();

    if (campaignError || !campaign) {
      return NextResponse.json({ error: 'Campaign not found in Supabase' }, { status: 404 });
    }

    // --- Step 1: Fetch addresses from Overture ---
    let addresses = [];
    
    if (polygon) {
      // Polygon mode: Fetch addresses inside polygon
      console.log('Step 1: Fetching addresses from polygon...');
      try {
        addresses = await OvertureService.getAddressesInPolygon(polygon);
        console.log(`Found ${addresses.length} addresses from polygon`);
      } catch (err: any) {
        console.error('Overture Polygon Query Error:', err);
        return NextResponse.json({ error: `Overture Data Error: ${err.message}` }, { status: 500 });
      }
    } else if (starting_address) {
      // Closest Home mode: Geocode and find nearest addresses
      // --- Step 1a: Geocoding ---
      let coordinates: { lat: number; lon: number };
      
      if (providedCoordinates) {
        coordinates = { lat: providedCoordinates.lat, lon: providedCoordinates.lng };
        console.log(`Step 1: Using provided coordinates: ${coordinates.lat}, ${coordinates.lon}`);
      } else {
        console.log(`Step 1: Geocoding address: ${starting_address}`);
        try {
          const geocoded = await MapService.geocodeAddress(starting_address);
          if (!geocoded) {
            throw new Error(`Geocoding returned null for: ${starting_address}`);
          }
          coordinates = geocoded;
          console.log(`Geocoded to: ${coordinates.lat}, ${coordinates.lon}`);
        } catch (err: any) {
          console.error('Geocoding failed:', err);
          return NextResponse.json({ error: `Geocoding failed: ${err.message}` }, { status: 400 });
        }
      }

      // --- Step 1b: Overture/MotherDuck Query ---
      console.log(`Step 2: Querying Overture for ${count} addresses...`);
      try {
        // Set a strict timeout for the Overture query (e.g., 25 seconds to avoid Vercel 30s limit hard crash)
        const overturePromise = OvertureService.getNearestHomes(coordinates.lat, coordinates.lon, count);
        
        // Simple timeout wrapper
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Overture query timed out (>25s)')), 25000)
        );

        addresses = await Promise.race([overturePromise, timeoutPromise]) as any[];
      } catch (err: any) {
        console.error('Overture Query Error:', err);
        return NextResponse.json({ error: `Overture Data Error: ${err.message}` }, { status: 500 });
      }
    }

    if (!addresses || addresses.length === 0) {
      return NextResponse.json({ inserted_count: 0, preview: [], message: polygon ? 'No addresses found in polygon' : 'No addresses found near location' });
    }
    console.log(`Found ${addresses.length} addresses from Overture`);

    // --- Step 3: Mapping & Database Insert ---
    try {
      const canonicalAddresses: CanonicalCampaignAddress[] = addresses.map(
        (address, index) => mapOvertureToCanonical(address, campaign_id, index)
      );

      // 1. Prepare raw insert data
      const rawInsertData = canonicalAddresses.map(addr => ({
        campaign_id: addr.campaign_id,
        formatted: addr.formatted,
        postal_code: addr.postal_code,
        source: addr.source,
        // seq: addr.seq,  // Removed: Let the database auto-generate the sequence number
        visited: addr.visited || false,
        geom: addr.geom,
        gers_id: addr.gers_id,
        house_number: addr.house_number || null,
        street_name: addr.street_name || null,
        locality: addr.locality || null,
        region: addr.region || null,
        building_gers_id: addr.building_gers_id || null,
      }));

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'generate-address-list/route.ts:126',message:'Raw insert data prepared',data:{totalCount:rawInsertData.length,hasGersId:rawInsertData.every(i=>i.gers_id!==undefined),gersIdNullCount:rawInsertData.filter(i=>!i.gers_id||i.gers_id==='').length,gersIdSample:rawInsertData.slice(0,3).map(i=>i.gers_id),sampleItem:rawInsertData[0]?{campaign_id:rawInsertData[0].campaign_id,formatted:rawInsertData[0].formatted,gers_id:rawInsertData[0].gers_id}:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'B'})}).catch(()=>{});
      // #endregion

      // 2. DEDUPLICATE: Remove records with duplicate (campaign_id, gers_id) combination
      // Filter out items without gers_id - they can't use the unique constraint for onConflict
      const itemsWithGersId = rawInsertData.filter(item => item.gers_id != null && item.gers_id !== '');
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'generate-address-list/route.ts:135',message:'Filtering items with gers_id',data:{totalItems:rawInsertData.length,itemsWithGersId:itemsWithGersId.length,itemsWithoutGersId:rawInsertData.length-itemsWithGersId.length,firstItemGersId:rawInsertData[0]?.gers_id},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      
      if (itemsWithGersId.length === 0) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'generate-address-list/route.ts:140',message:'No items with gers_id found',data:{totalItems:rawInsertData.length,allGersIds:rawInsertData.map(i=>i.gers_id)},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
        throw new Error('No addresses with gers_id found. All addresses must have a gers_id from Overture.');
      }
      
      const uniqueInsertData = Array.from(
        new Map(itemsWithGersId.map(item => [`${item.campaign_id}-${item.gers_id}`, item])).values()
      );

      console.log(`Step 3: Upserting ${uniqueInsertData.length} unique rows (filtered from ${rawInsertData.length}, ${rawInsertData.length - itemsWithGersId.length} without gers_id) to Supabase...`);

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'generate-address-list/route.ts:151',message:'Before upsert - checking data structure',data:{uniqueInsertDataCount:uniqueInsertData.length,firstItemKeys:uniqueInsertData[0]?Object.keys(uniqueInsertData[0]):null,hasGersId:uniqueInsertData[0]?.gers_id!==undefined,onConflictTarget:'campaign_id,gers_id',itemsWithoutGersId:rawInsertData.length-itemsWithGersId.length,firstItemSample:uniqueInsertData[0]?{campaign_id:uniqueInsertData[0].campaign_id,gers_id:uniqueInsertData[0].gers_id}:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'A'})}).catch(()=>{});
      // #endregion

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'generate-address-list/route.ts:137',message:'Attempting upsert with onConflict',data:{onConflict:'campaign_id,gers_id',uniqueInsertDataSample:uniqueInsertData.slice(0,2).map(i=>({campaign_id:i.campaign_id,formatted:i.formatted,gers_id:i.gers_id}))},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'A'})}).catch(()=>{});
      // #endregion

      // 3. Upsert the CLEAN list using the existing unique constraint
      const { data: insertedData, error: insertError } = await supabase
        .from('campaign_addresses')
        .upsert(uniqueInsertData, {
          onConflict: 'campaign_id,gers_id',
        })
        .select();

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'generate-address-list/route.ts:144',message:'After upsert - error check',data:{hasError:!!insertError,errorMessage:insertError?.message,errorCode:insertError?.code,errorDetails:insertError?.details,errorHint:insertError?.hint,insertedCount:insertedData?.length||0,uniqueInsertDataLength:uniqueInsertData.length,firstItemGersId:uniqueInsertData[0]?.gers_id},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'A'})}).catch(()=>{});
      // #endregion

      if (insertError) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/a6f366c9-64c5-41b8-a570-53cdd9ef80a7',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'generate-address-list/route.ts:173',message:'Upsert error details',data:{errorMessage:insertError.message,errorCode:insertError.code,errorDetails:insertError.details,errorHint:insertError.hint,fullError:JSON.stringify(insertError),uniqueInsertDataLength:uniqueInsertData.length,firstItem:uniqueInsertData[0],onConflictUsed:'campaign_id,gers_id'},timestamp:Date.now(),sessionId:'debug-session',runId:'run3',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        
        // Enhanced error message with troubleshooting info
        const errorMsg = `Supabase Upsert Error: ${insertError.message}`;
        console.error('[generate-address-list] Upsert failed:', {
          error: insertError,
          errorCode: insertError.code,
          errorHint: insertError.hint,
          dataCount: uniqueInsertData.length,
          firstItem: uniqueInsertData[0],
          onConflict: 'campaign_id,gers_id',
          troubleshooting: 'If error mentions "no unique constraint", run migration 20250128000006_standardize_gers_id_columns.sql'
        });
        
        throw new Error(errorMsg);
      }

      const insertedCount = insertedData?.length || 0;
      console.log(`Successfully inserted ${insertedCount} addresses`);

      // Update total count asynchronously (don't await strictly if speed is concern, but good to keep sync)
      const { count: totalCount } = await supabase
        .from('campaign_addresses')
        .select('*', { count: 'exact', head: true })
        .eq('campaign_id', campaign_id);

      if (totalCount !== null) {
        await supabase.from('campaigns').update({ total_flyers: totalCount }).eq('id', campaign_id);
      }

      // Update campaign bbox from addresses (automatic calculation for Closest Home tool)
      try {
        const { error: bboxError } = await supabase.rpc('update_campaign_bbox', {
          p_campaign_id: campaign_id,
        });
        if (bboxError) {
          console.error('Error updating campaign bbox:', bboxError);
          // Don't fail the request if bbox update fails - it's not critical
        } else {
          console.log('Successfully updated campaign bbox from addresses');
        }
      } catch (bboxUpdateError) {
        console.error('Failed to update campaign bbox:', bboxUpdateError);
        // Don't fail the request if bbox update fails - it's not critical
      }

      const preview = (insertedData || []).slice(0, 10).map(addr => ({
        id: addr.id,
        formatted: addr.formatted,
        postal_code: addr.postal_code,
        source: addr.source,
        gers_id: addr.gers_id,
      }));

      return NextResponse.json({ inserted_count: insertedCount, preview });

    } catch (err: any) {
      console.error('Database Step Error:', err);
      return NextResponse.json({ error: `Database Error: ${err.message}` }, { status: 500 });
    }

  } catch (error: any) {
    console.error('Unhandled API Error:', error);
    // Return the actual error message to the client for debugging
    return NextResponse.json(
      { error: error.message || 'Unknown server error' },
      { status: 500 }
    );
  }
}
