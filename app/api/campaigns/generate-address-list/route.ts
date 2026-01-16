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
  starting_address: string;
  count?: number;
  coordinates?: {
    lat: number;
    lng: number;
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
    const { campaign_id, starting_address, count = 50, coordinates: providedCoordinates } = body;

    // Validate input
    if (!campaign_id) return NextResponse.json({ error: 'campaign_id is required' }, { status: 400 });
    if (!starting_address) return NextResponse.json({ error: 'starting_address is required' }, { status: 400 });

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

    // --- Step 1: Geocoding ---
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

    // --- Step 2: Overture/MotherDuck Query ---
    console.log(`Step 2: Querying Overture for ${count} addresses...`);
    let addresses = [];
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

    if (!addresses || addresses.length === 0) {
      return NextResponse.json({ inserted_count: 0, preview: [], message: 'No addresses found near location' });
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
        source_id: addr.source_id,
      }));

      // 2. DEDUPLICATE: Remove records with duplicate (campaign_id, formatted) combination
      // This matches the onConflict constraint, ensuring no row is updated twice
      const uniqueInsertData = Array.from(
        new Map(rawInsertData.map(item => [`${item.campaign_id}-${item.formatted}`, item])).values()
      );

      console.log(`Step 3: Upserting ${uniqueInsertData.length} unique rows (filtered from ${rawInsertData.length}) to Supabase...`);

      // 3. Upsert the CLEAN list
      const { data: insertedData, error: insertError } = await supabase
        .from('campaign_addresses')
        .upsert(uniqueInsertData, {
          onConflict: 'campaign_id,formatted',
        })
        .select();

      if (insertError) throw new Error(`Supabase Upsert Error: ${insertError.message}`);

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

      const preview = (insertedData || []).slice(0, 10).map(addr => ({
        id: addr.id,
        formatted: addr.formatted,
        postal_code: addr.postal_code,
        source: addr.source,
        source_id: addr.source_id,
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
