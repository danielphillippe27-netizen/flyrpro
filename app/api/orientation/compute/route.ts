import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { OrientationService } from '@/lib/services/OrientationService';
import { CampaignsService } from '@/lib/services/CampaignsService';

export async function POST(request: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();

    // Authenticate user
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { campaignId, addressIds } = body;

    // Validate input
    if (!campaignId && (!addressIds || !Array.isArray(addressIds) || addressIds.length === 0)) {
      return NextResponse.json(
        { error: 'Either campaignId or addressIds array is required' },
        { status: 400 }
      );
    }

    // Fetch addresses
    let addresses;
    if (campaignId) {
      // Fetch all addresses for campaign that are not oriented and not locked
      const allAddresses = await CampaignsService.fetchAddresses(campaignId);
      addresses = allAddresses.filter(
        (addr) => !addr.is_oriented && !addr.orientation_locked
      );
    } else {
      // Fetch specific addresses
      const { data, error } = await supabase
        .from('campaign_addresses')
        .select('*')
        .in('id', addressIds)
        .eq('is_oriented', false)
        .eq('orientation_locked', false);

      if (error) throw error;
      addresses = data || [];
    }

    if (addresses.length === 0) {
      return NextResponse.json({
        success: true,
        processed: 0,
        message: 'No addresses need orientation',
      });
    }

    // Compute orientations
    const results = await OrientationService.computeAddressOrientation(addresses);

    // Batch update Supabase (in chunks of 100)
    const BATCH_SIZE = 100;
    let successCount = 0;
    let errorCount = 0;
    const errors: Array<{ addressId: string; error: string }> = [];

    for (let i = 0; i < results.length; i += BATCH_SIZE) {
      const batch = results.slice(i, i + BATCH_SIZE);

      const updates = batch.map((result) => ({
        id: result.addressId,
        road_bearing: result.roadBearing,
        house_bearing: result.houseBearing,
        street_name: result.streetName,
        is_oriented: true, // Mark as oriented even if failed (to prevent retry loops)
      }));

      try {
        const { error: updateError } = await supabase
          .from('campaign_addresses')
          .upsert(updates, { onConflict: 'id' });

        if (updateError) {
          console.error('Error updating addresses:', updateError);
          errorCount += batch.length;
          batch.forEach((result) => {
            errors.push({
              addressId: result.addressId,
              error: updateError.message,
            });
          });
        } else {
          // Count successful updates
          batch.forEach((result) => {
            if (result.success) {
              successCount++;
            } else {
              errorCount++;
              errors.push({
                addressId: result.addressId,
                error: result.error || 'Unknown error',
              });
            }
          });
        }
      } catch (batchError) {
        console.error('Error in batch update:', batchError);
        errorCount += batch.length;
        batch.forEach((result) => {
          errors.push({
            addressId: result.addressId,
            error: batchError instanceof Error ? batchError.message : 'Batch update failed',
          });
        });
      }
    }

    return NextResponse.json({
      success: true,
      processed: results.length,
      successful: successCount,
      errors: errorCount,
      errorDetails: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error('Error computing orientations:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}


