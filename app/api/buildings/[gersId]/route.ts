import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { createAdminClient } from '@/lib/supabase/server';
import { validateGersId } from '@/lib/utils/uuid';
import { getEntitlementForUser, canUsePro } from '@/app/lib/billing/entitlements';

export const runtime = 'nodejs';

const DEFAULT_SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';

function getSupabaseUrl(): string {
  return (DEFAULT_SUPABASE_URL || '').trim().replace(/\/$/, '') || DEFAULT_SUPABASE_URL;
}
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Resolve current user ID from Bearer token (iOS) or cookies (web). Returns null if unauthenticated.
 */
async function getUserIdFromRequest(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    if (!SUPABASE_ANON_KEY) return null;
    const supabase = createClient(getSupabaseUrl(), SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return null;
    return user.id;
  }
  const cookieStore = await cookies();
  const { createServerClient } = await import('@supabase/ssr');
  if (!SUPABASE_ANON_KEY) return null;
  const supabase = createServerClient(getSupabaseUrl(), SUPABASE_ANON_KEY!, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: object }[]) {
        cookiesToSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options)
        );
      },
    },
  });
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/**
 * GET endpoint for fetching building details by GERS ID
 *
 * QR scan data (scans, last_scanned_at) is only returned for Pro/Team subscribers.
 * Free or unauthenticated callers receive scans: 0, last_scanned_at: null.
 *
 * @param gersId - The Overture GERS ID (gers_id in campaign_addresses) - UUID v4 format
 * @param campaignId - Optional query parameter to filter by specific campaign
 *
 * @returns Building details; scan fields gated by entitlement
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ gersId: string }> }
) {
  try {
    const { gersId } = await params;

    if (!gersId) {
      return NextResponse.json(
        { error: 'GERS ID is required' },
        { status: 400 }
      );
    }

    // Validate and normalize GERS ID to UUID format
    let normalizedGersId: string;
    try {
      normalizedGersId = validateGersId(gersId, 'GERS ID');
    } catch (error: any) {
      return NextResponse.json(
        { error: 'Invalid GERS ID format', message: error.message },
        { status: 400 }
      );
    }

    // Optional campaign filter from query params
    const searchParams = request.nextUrl.searchParams;
    const campaignId = searchParams.get('campaign_id');

    const userId = await getUserIdFromRequest(request);
    const canShowScans =
      userId != null &&
      canUsePro(await getEntitlementForUser(userId));

    const supabase = createAdminClient();

    // Query campaign_addresses by gers_id (GERS ID)
    // Query both gers_id (text) and gers_id_uuid (uuid) columns for compatibility
    let query = supabase
      .from('campaign_addresses')
      .select(`
        id,
        campaign_id,
        address,
        formatted,
        postal_code,
        source,
        gers_id,
        visited,
        scans,
        last_scanned_at,
        created_at,
        campaigns!inner (
          id,
          title,
          name,
          status
        )
      `)
      .or(`gers_id.eq.${normalizedGersId},gers_id_uuid.eq.${normalizedGersId}`);

    // Optional campaign filter
    if (campaignId) {
      query = query.eq('campaign_id', campaignId);
    }

    const { data: addresses, error } = await query;

    if (error) {
      console.error('[Buildings API] Error querying campaign_addresses:', error);
      return NextResponse.json(
        { 
          error: 'Failed to fetch building data',
          message: error.message 
        },
        { status: 500 }
      );
    }

    // If no addresses found, return 404
    if (!addresses || addresses.length === 0) {
      return NextResponse.json(
        { 
          error: 'Building not found',
          message: `No address found with GERS ID: ${gersId}` 
        },
        { status: 404 }
      );
    }

    // If multiple addresses found (same GERS ID in different campaigns),
    // return the first one, or all if no campaign filter was applied
    const address = addresses[0];
    const campaign = address.campaigns as any;

    // Build response; only include real scan data for Pro/Team users
    const response = {
      gers_id: gersId,
      address_id: address.id,
      campaign_id: address.campaign_id,
      campaign_name: campaign?.title || campaign?.name || 'Unknown Campaign',
      campaign_status: campaign?.status || 'unknown',
      address: address.formatted || address.address || '',
      postal_code: address.postal_code || null,
      source: address.source || null,
      status: address.visited ? 'visited' : 'not_visited',
      visited: address.visited || false,
      scans: canShowScans ? (address.scans || 0) : 0,
      last_scanned_at: canShowScans ? (address.last_scanned_at || null) : null,
      created_at: address.created_at,
      // Include all addresses if multiple found (for debugging)
      ...(addresses.length > 1 && !campaignId ? { 
        _note: `Multiple addresses found for this GERS ID (${addresses.length} total)`,
        _all_address_ids: addresses.map(a => a.id)
      } : {})
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('[Buildings API] Unexpected error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
