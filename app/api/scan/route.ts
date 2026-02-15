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
      // Normalize: collapse spaces, trim (Canva often sends "2 PATTERSON CRES  , AJAX , ON L1S6R1")
      const normalized = addressLine
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/\s*,\s*/g, ', ')
        .toLowerCase();
      const line = normalized;
      const lineLower = line;
      // Street-only part (before first comma) for flexible matching
      const streetPart = line.split(',')[0]?.trim() || line;
      
      const fetchCandidates = async (predicate: (q: ReturnType<typeof supabase.from>) => ReturnType<typeof supabase.from>) => {
        const q = supabase
          .from('campaign_addresses_geojson')
          .select('id, campaign_id, address, formatted, locality, region, postal_code, house_number')
          .eq('campaign_id', campaignId);
        const { data } = await predicate(q).limit(20);
        return data || [];
      };
      
      // Strategy 1: Exact match on address or formatted (use streetPart to avoid comma in .or())
      let candidates = await fetchCandidates((q) => {
        const s = streetPart.replace(/'/g, "''");
        return q.or(`address.ilike.${s},formatted.ilike.${s}`);
      });
      if (candidates.length > 0) {
        const fullMatch = candidates.find(
          (r) => (r.address || '').toLowerCase() === line || (r.formatted || '').toLowerCase() === line
        );
        addressId = (fullMatch || candidates[0]).id;
        console.log('Found exact address match:', addressId);
      }
      
      // Strategy 2: Contains full normalized string
      if (!addressId) {
        const escaped = line.replace(/%/g, '\\%').replace(/_/g, '\\_');
        candidates = await fetchCandidates((q) => q.or(`address.ilike.%${escaped}%,formatted.ilike.%${escaped}%`));
        if (candidates.length > 0) {
          const scored = candidates.map((row) => {
            let score = 0;
            const a = (row.address || '').toLowerCase();
            const f = (row.formatted || '').toLowerCase();
            if (a === line || f === line) score += 100;
            else if (a.includes(line) || f.includes(line)) score += 50;
            else if (line.includes(a) || line.includes(f)) score += 30;
            if (city && (row.locality || '').toLowerCase().includes(city.toLowerCase().trim())) score += 20;
            if (postalCode && (row.postal_code || '').toLowerCase().includes(postalCode.toLowerCase().trim())) score += 15;
            return { row, score };
          }).sort((x, y) => y.score - x.score);
          addressId = scored[0].row.id;
          console.log('Found contains match:', addressId, 'score:', scored[0].score);
        }
      }
      
      // Strategy 3: Street-only match (e.g. "2 patterson cres" from "2 patterson cres, ajax, on l1s6r1")
      if (!addressId && streetPart.length >= 5) {
        const escapedStreet = streetPart.replace(/%/g, '\\%').replace(/_/g, '\\_');
        candidates = await fetchCandidates((q) => q.or(`address.ilike.%${escapedStreet}%,formatted.ilike.%${escapedStreet}%`));
        if (candidates.length > 0) {
          // Prefer row whose address/formatted starts with street part
          const best = candidates.find(
            (r) =>
              (r.address || '').toLowerCase().startsWith(streetPart) ||
              (r.formatted || '').toLowerCase().startsWith(streetPart)
          ) || candidates[0];
          addressId = best.id;
          console.log('Found street-only match:', addressId);
        }
      }
      
      // Strategy 4: House number + postal (when province has postal merged like "ON L1S6R1")
      if (!addressId && postalCode) {
        const houseNum = line.match(/^\d+/)?.[0];
        if (houseNum) {
          candidates = await fetchCandidates((q) =>
            q.ilike('house_number', houseNum).ilike('postal_code', `%${postalCode.trim()}%`)
          );
          if (candidates.length > 0) {
            addressId = candidates[0].id;
            console.log('Found house+postal match:', addressId);
          }
        }
      }
      
      // Strategy 5: Last resort - fetch all addresses for campaign, match in JS (handles any formatting)
      if (!addressId) {
        const { data: allRows } = await supabase
          .from('campaign_addresses_geojson')
          .select('id, address, formatted, locality, region, postal_code, house_number')
          .eq('campaign_id', campaignId)
          .limit(500);
        if (allRows?.length) {
          const norm = (s: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
          const postal = (postalCode || '').toLowerCase().trim().replace(/\s/g, '');
          const houseNum = line.match(/^\d+/)?.[0];
          for (const row of allRows) {
            const a = norm(row.address || '');
            const f = norm(row.formatted || '');
            const rowPostal = (row.postal_code || '').toLowerCase().replace(/\s/g, '');
            if (streetPart.length >= 5 && (a.includes(streetPart) || f.includes(streetPart) || a.startsWith(streetPart) || f.startsWith(streetPart))) {
              addressId = row.id;
              console.log('Found last-resort street match:', addressId);
              break;
            }
            if (postal && rowPostal && rowPostal.includes(postal) && houseNum && (row.house_number || a || f).includes(houseNum)) {
              addressId = row.id;
              console.log('Found last-resort postal+house match:', addressId);
              break;
            }
          }
        }
      }
      
      if (!addressId) {
        console.error('Failed to resolve address for Canva-style QR:', { campaignId, addressLine, streetPart, postalCode });
      }
    }

    // If still no addressId, redirect to campaign URL or app URL (no welcome page)
    if (!addressId) {
      console.warn('No address ID resolved, redirecting to campaign or app URL without tracking');
      const fallbackUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
      if (campaignId) {
        const { data: camp } = await supabase.from('campaigns').select('video_url').eq('id', campaignId).single();
        if (camp?.video_url?.trim()) {
          return NextResponse.redirect(camp.video_url.trim(), { status: 302 });
        }
      }
      return NextResponse.redirect(fallbackUrl, { status: 302 });
    }

    // Fetch full address record to get campaign_id and other details
    const { data: address, error: addressError } = await supabase
      .from('campaign_addresses_geojson')
      .select('id, campaign_id, address, formatted')
      .eq('id', addressId)
      .single();

    if (addressError || !address) {
      console.error('Error fetching address:', addressError);
      const fallbackUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
      return NextResponse.redirect(fallbackUrl, { status: 302 });
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

    // Redirect to campaign URL (video_url) or app URL — no welcome page
    if (campaign?.video_url && campaign.video_url.trim() !== '') {
      console.log('Redirecting to campaign URL:', campaign.video_url);
      return NextResponse.redirect(campaign.video_url.trim(), { status: 302 });
    }

    const fallbackUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    console.log('Redirecting to app URL (no campaign URL set):', fallbackUrl);
    return NextResponse.redirect(fallbackUrl, { status: 302 });
    
  } catch (error) {
    console.error('Error in scan handler:', error);
    const fallbackUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    return NextResponse.redirect(fallbackUrl, { status: 302 });
  }
}
