import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * Export Flyer API Route
 * 
 * TODO: Implement server-side export functionality
 * - Accept PNG data URL from client
 * - Upload to Supabase storage bucket 'flyers'
 * - Store at path: flyers/{campaignId}/{flyerId}/export.png
 * - Return public URL
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ flyerId: string }> }
) {
  try {
    const resolvedParams = await params;
    const { flyerId } = resolvedParams;

    const body = await request.json();
    const { dataUrl, campaignId } = body;

    if (!dataUrl || !campaignId) {
      return NextResponse.json(
        { error: 'Missing dataUrl or campaignId' },
        { status: 400 }
      );
    }

    // TODO: Convert data URL to buffer
    // const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');

    // TODO: Upload to Supabase storage
    // const supabase = createAdminClient();
    // const filePath = `flyers/${campaignId}/${flyerId}/export.png`;
    // const { error: uploadError } = await supabase.storage
    //   .from('flyers')
    //   .upload(filePath, buffer, {
    //     contentType: 'image/png',
    //     upsert: true,
    //   });
    //
    // if (uploadError) {
    //   throw new Error(`Failed to upload: ${uploadError.message}`);
    // }
    //
    // const { data: { publicUrl } } = supabase.storage
    //   .from('flyers')
    //   .getPublicUrl(filePath);

    return NextResponse.json({
      message: 'Export functionality not yet implemented',
      // TODO: Return publicUrl when implemented
    });
  } catch (error) {
    console.error('Error exporting flyer:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Export failed' },
      { status: 500 }
    );
  }
}



