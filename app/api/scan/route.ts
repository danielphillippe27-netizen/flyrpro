import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  
  // Extract all possible params first for logging/debugging
  const rawId = searchParams.get('id');
  const campaignId = searchParams.get('campaignId');
  const addressLine = searchParams.get('address') || searchParams.get('AddressLine');
  const city = searchParams.get('city') || searchParams.get('City');
  const province = searchParams.get('province') || searchParams.get('Province');
  const postalCode = searchParams.get('postalCode') || searchParams.get('PostalCode');
  
  console.log('Scan request received:', {
    id: rawId,
    campaignId,
    address: addressLine,
    city,
    province,
    postalCode,
    url: request.url
  });

  try {
    let addressId: string | null = rawId;
    
    const supabase = createAdminClient();

    // If no id, try to resolve from campaignId + address (e.g. Canva-generated QR)
    if (!addressId && campaignId && addressLine) {
      console.log('Attempting to resolve address from Canva-style params:', { campaignId, addressLine });
      
      // Try multiple matching strategies
      const line = addressLine.trim();
      const lineLower = line.toLowerCase();
      
      // Strategy 1: Try exact match on address field
      let { data: exactMatch, error: exactError } = await supabase
        .from('campaign_addresses')
        .select('id, campaign_id, address, formatted, locality, region, postal_code')
        .eq('campaign_id', campaignId)
        .ilike('address', line)
        .maybeSingle();
      
      if (exactMatch) {
        console.log('Found exact address match:', exactMatch.id);
        addressId = exactMatch.id;
      } else {
        // Strategy 2: Try match on formatted field
        let { data: formattedMatch, error: formattedError } = await supabase
          .from('campaign_addresses')
          .select('id, campaign_id, address, formatted, locality, region, postal_code')
          .eq('campaign_id', campaignId)
          .ilike('formatted', line)
          .maybeSingle();
        
        if (formattedMatch) {
          console.log('Found formatted address match:', formattedMatch.id);
          addressId = formattedMatch.id;
        } else {
          // Strategy 3: Partial match - address contains the query
          let { data: partialMatches, error: partialError } = await supabase
            .from('campaign_addresses')
            .select('id, campaign_id, address, formatted, locality, region, postal_code')
            .eq('campaign_id', campaignId)
            .or(`address.ilike.%${line}%,formatted.ilike.%${line}%`)
            .limit(10);
          
          if (partialMatches && partialMatches.length > 0) {
            // Try to find best match by scoring
            const scored = partialMatches.map(row => {
              let score = 0;
              const rowAddress = (row.address || '').toLowerCase();
              const rowFormatted = (row.formatted || '').toLowerCase();
              
              // Higher score for exact or closer matches
              if (rowAddress === lineLower || rowFormatted === lineLower) score += 100;
              else if (rowAddress.includes(lineLower) || rowFormatted.includes(lineLower)) score += 50;
              else if (lineLower.includes(rowAddress) || lineLower.includes(rowFormatted)) score += 30;
              
              // Bonus for city/province match if provided
              if (city && (row.locality || '').toLowerCase().includes(city.toLowerCase())) score += 20;
              if (province && (row.region || '').toLowerCase().includes(province.toLowerCase())) score += 20;
              
              return { row, score };
            }).sort((a, b) => b.score - a.score);
            
            console.log('Found partial address match:', scored[0].row.id, 'with score:', scored[0].score);
            addressId = scored[0].row.id;
          } else {
            // Strategy 4: Very loose match - try token matching for house number + street
            // Extract potential house number
            const houseNumberMatch = line.match(/^\d+/);
            if (houseNumberMatch) {
              const houseNumber = houseNumberMatch[0];
              let { data: houseMatches, error: houseError } = await supabase
                .from('campaign_addresses')
                .select('id, campaign_id, address, formatted, house_number')
                .eq('campaign_id', campaignId)
                .ilike('house_number', houseNumber)
                .limit(20);
              
              if (houseMatches && houseMatches.length > 0) {
                console.log('Found house number match:', houseMatches[0].id);
                addressId = houseMatches[0].id;
              }
            }
          }
        }
      }
      
      if (!addressId) {
        console.error('Failed to resolve address for Canva-style QR:', { campaignId, addressLine });
      }
    }

    // If still no addressId, we can't track the scan properly
    // But we still redirect to welcome so user doesn't see an error
    if (!addressId) {
      console.warn('No address ID resolved, redirecting to welcome without tracking');
      const welcomeUrl = new URL('/welcome', request.url);
      // Preserve any params we got for debugging
      if (campaignId) welcomeUrl.searchParams.set('campaignId', campaignId);
      if (addressLine) welcomeUrl.searchParams.set('address', addressLine);
      return NextResponse.redirect(welcomeUrl, { status: 302 });
    }

    // Fetch full address record to get campaign_id and other details
    const { data: address, error: addressError } = await supabase
      .from('campaign_addresses')
      .select('id, campaign_id, address, formatted')
      .eq('id', addressId)
      .single();

    if (addressError || !address) {
      console.error('Error fetching address:', addressError);
      // Still redirect to welcome, but include the ID we tried
      const welcomeUrl = new URL('/welcome', request.url);
      welcomeUrl.searchParams.set('id', addressId);
      return NextResponse.redirect(welcomeUrl, { status: 302 });
    }

    console.log('Processing scan for address:', { addressId: address.id, campaignId: address.campaign_id });

    // Look up the building using the stable linker (building_address_links table)
    let buildingId: string | null = null;
    let buildingGersId: string | null = null;
    
    try {
      const { data: link, error: linkError } = await supabase
        .from('building_address_links')
        .select('building_id, buildings!inner(id, gers_id)')
        .eq('address_id', addressId)
        .eq('campaign_id', address.campaign_id)
        .single();

      if (!linkError && link) {
        buildingId = link.building_id;
        const building = link.buildings as { id: string; gers_id: string | null };
        buildingGersId = building?.gers_id || null;
        console.log('Found building via stable linker:', { buildingId, buildingGersId });
      } else {
        console.warn('No building_address_link found for address:', addressId, linkError?.message);
      }
    } catch (linkLookupError) {
      console.error('Failed to lookup building via linker:', linkLookupError);
    }

    // Insert scan event for analytics (always try to track)
    try {
      const { error: scanEventError } = await supabase
        .from('scan_events')
        .insert({
          building_id: buildingId,
          campaign_id: address.campaign_id,
          address_id: addressId,
          scanned_at: new Date().toISOString(),
        });

      if (scanEventError) {
        console.error('Error inserting scan event:', scanEventError);
      } else {
        console.log('Scan event recorded for address:', addressId);
      }
    } catch (scanEventInsertError) {
      console.error('Failed to insert scan event:', scanEventInsertError);
    }

    // Update building_stats for map visualization
    if (buildingGersId) {
      try {
        const { error: rpcError } = await supabase.rpc('increment_building_scans', {
          p_gers_id: buildingGersId,
          p_campaign_id: address.campaign_id,
        });
        
        if (rpcError) {
          console.error('Error incrementing building scans via RPC:', rpcError);
          
          // Fallback: Try direct insert/update
          const { error: directError } = await supabase
            .from('building_stats')
            .upsert({
              gers_id: buildingGersId,
              campaign_id: address.campaign_id,
              scans_total: 1,
              scans_today: 1,
              status: 'visited',
              last_scan_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }, {
              onConflict: 'gers_id',
            });
          
          if (directError) {
            console.error('Error with direct building_stats upsert:', directError);
          }
        } else {
          console.log('Updated building_stats via RPC for building gers_id:', buildingGersId);
        }
      } catch (statsInsertError) {
        console.error('Failed to update building_stats:', statsInsertError);
      }
    }

    // Track the scan using the secure RPC function (legacy tracking on campaign_addresses)
    try {
      const { error: scanError } = await supabase.rpc('increment_scan', {
        row_id: addressId,
      });

      if (scanError) {
        console.error('Error tracking scan via increment_scan RPC:', scanError);
      } else {
        console.log('Incremented scan count for address:', addressId);
      }
    } catch (trackingError) {
      console.error('Failed to track scan:', trackingError);
    }

    // Fetch campaign to get video_url for redirect
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('video_url')
      .eq('id', address.campaign_id)
      .single();

    if (campaignError) {
      console.error('Error fetching campaign:', campaignError);
    }

    // Redirect based on campaign configuration
    if (campaign?.video_url && campaign.video_url.trim() !== '') {
      console.log('Redirecting to video URL:', campaign.video_url);
      return NextResponse.redirect(campaign.video_url, { status: 302 });
    }

    // Fallback: Redirect to welcome page with address ID
    const welcomeUrl = new URL('/welcome', request.url);
    welcomeUrl.searchParams.set('id', addressId);
    console.log('Redirecting to welcome page:', welcomeUrl.toString());
    return NextResponse.redirect(welcomeUrl, { status: 302 });
    
  } catch (error) {
    console.error('Error in scan handler:', error);
    // Fallback to welcome page on any error, preserving params for debugging
    const welcomeUrl = new URL('/welcome', request.url);
    if (rawId) welcomeUrl.searchParams.set('id', rawId);
    if (campaignId) welcomeUrl.searchParams.set('campaignId', campaignId);
    if (addressLine) welcomeUrl.searchParams.set('address', addressLine);
    return NextResponse.redirect(welcomeUrl, { status: 302 });
  }
}
