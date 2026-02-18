import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';

const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
];
const MAX_SIZE_MB = 10;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    const { campaignId } = await params;
    if (!campaignId) {
      return NextResponse.json({ error: 'Missing campaignId' }, { status: 400 });
    }

    const serverClient = await getSupabaseServerClient();
    const { data: { session } } = await serverClient.auth.getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminClient();
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('id, owner_id')
      .eq('id', campaignId)
      .single();

    if (campaignError || !campaign || campaign.owner_id !== session.user.id) {
      return NextResponse.json({ error: 'Campaign not found or access denied' }, { status: 404 });
    }

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json(
        { error: 'Request must be multipart/form-data. Do not set Content-Type manually when sending FormData.' },
        { status: 400 }
      );
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (parseError) {
      console.error('FormData parse error:', parseError);
      return NextResponse.json(
        { error: 'Invalid form data. Please upload a file using the file input.' },
        { status: 400 }
      );
    }

    const file = formData.get('file') as File | null;
    if (!file || !file.size) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Invalid file type. Use image (JPEG, PNG, WebP, GIF) or PDF.' },
        { status: 400 }
      );
    }

    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_SIZE_MB}MB.` },
        { status: 400 }
      );
    }

    const ext = file.type === 'application/pdf' ? 'pdf' : file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf'].includes(ext) ? ext : 'jpg';
    const path = `campaign-flyers/${campaignId}/${crypto.randomUUID()}.${safeExt}`;

    const arrayBuffer = await file.arrayBuffer();
    const { error: uploadError } = await supabase.storage
      .from('flyers')
      .upload(path, arrayBuffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error('Flyer upload error:', uploadError);
      return NextResponse.json(
        { error: uploadError.message || 'Upload failed' },
        { status: 500 }
      );
    }

    const { data: urlData } = supabase.storage.from('flyers').getPublicUrl(path);
    const flyerUrl = urlData.publicUrl;

    const { error: updateError } = await supabase
      .from('campaigns')
      .update({ flyer_url: flyerUrl })
      .eq('id', campaignId);

    if (updateError) {
      console.error('Error saving flyer_url:', updateError);
      return NextResponse.json({ error: 'Failed to save flyer URL' }, { status: 500 });
    }

    return NextResponse.json({ flyer_url: flyerUrl });
  } catch (error) {
    console.error('Flyer upload error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
