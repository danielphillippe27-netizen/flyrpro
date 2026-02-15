import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/qr/delete
 *
 * Deletes all QR codes for a campaign and clears QR fields on campaign_addresses.
 * Requires authenticated user and campaign ownership.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { campaignId, deleteFromS3 } = body as { campaignId?: string; deleteFromS3?: boolean };

    if (!campaignId) {
      return NextResponse.json(
        { error: 'campaignId is required' },
        { status: 400 }
      );
    }

    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('owner_id')
      .eq('id', campaignId)
      .single();

    if (campaignError || !campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    if (campaign.owner_id !== user.id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const admin = createAdminClient();
    const errors: string[] = [];

    let qrCodesDeleted = 0;
    const { data: deletedQRCodes, error: deleteQRError } = await admin
      .from('qr_codes')
      .delete()
      .eq('campaign_id', campaignId)
      .select('id');

    if (deleteQRError) {
      errors.push(deleteQRError.message);
    } else {
      qrCodesDeleted = deletedQRCodes?.length ?? 0;
    }

    const { data: updatedAddresses, error: updateAddrError } = await admin
      .from('campaign_addresses')
      .update({
        qr_code_base64: null,
        purl: null,
        qr_png_url: null,
      })
      .eq('campaign_id', campaignId)
      .select('id');

    if (updateAddrError) {
      errors.push(updateAddrError.message);
    }

    const addressesCleared = updatedAddresses?.length ?? 0;

    let s3Deleted = 0;
    if (deleteFromS3 && updatedAddresses?.length) {
      // Optional: delete from Supabase Storage or S3 if needed later
      // For now we only clear DB columns; qr_png_url may point to storage.
      s3Deleted = 0;
    }

    const success = errors.length === 0;
    return NextResponse.json(
      {
        success,
        message: success
          ? `Deleted ${qrCodesDeleted} QR code(s) and cleared ${addressesCleared} address(es).`
          : `Completed with errors: ${errors.join('; ')}`,
        results: {
          addressesCleared,
          qrCodesDeleted,
          s3Deleted,
          errors,
        },
      },
      { status: success ? 200 : 500 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to delete QR codes';
    console.error('[DeleteQR] Fatal error:', error);
    return NextResponse.json(
      {
        error: message,
        success: false,
        message,
        results: {
          addressesCleared: 0,
          qrCodesDeleted: 0,
          s3Deleted: 0,
          errors: [message],
        },
      },
      { status: 500 }
    );
  }
}
