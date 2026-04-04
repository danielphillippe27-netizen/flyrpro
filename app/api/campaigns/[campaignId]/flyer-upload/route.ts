import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  buildLegacyCampaignText,
  isMissingCampaignColumnErrorMessage,
  parseLegacyCampaignText,
} from '@/lib/campaignLegacyFields';

export const runtime = 'nodejs';

const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
];
const MAX_SIZE_MB = 10;

const STORAGE_UPLOAD_ATTEMPTS = 3;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  try {
    const { campaignId } = await params;
    if (!campaignId) {
      return NextResponse.json({ error: 'Missing campaignId' }, { status: 400 });
    }

    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createAdminClient();
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('id, owner_id, workspace_id, description')
      .eq('id', campaignId)
      .maybeSingle();

    if (campaignError || !campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    let allowed = campaign.owner_id === requestUser.id;
    if (!allowed && campaign.workspace_id) {
      const { data: member } = await supabase
        .from('workspace_members')
        .select('user_id')
        .eq('workspace_id', campaign.workspace_id)
        .eq('user_id', requestUser.id)
        .maybeSingle();
      allowed = !!member?.user_id;
    }
    if (!allowed) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
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

    let uploadError: { message: string } | null = null;
    for (let attempt = 1; attempt <= STORAGE_UPLOAD_ATTEMPTS; attempt++) {
      const { error } = await supabase.storage
        .from('flyers')
        .upload(path, arrayBuffer, {
          contentType: file.type,
          upsert: false,
        });
      if (!error) {
        uploadError = null;
        break;
      }
      uploadError = error;
      if (attempt < STORAGE_UPLOAD_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }

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
      const errorMessage = updateError.message || 'Failed to save flyer URL';
      if (isMissingCampaignColumnErrorMessage(errorMessage, 'flyer_url')) {
        const legacy = parseLegacyCampaignText(campaign.description);
        const { error: legacyUpdateError } = await supabase
          .from('campaigns')
          .update({
            description: buildLegacyCampaignText({
              notes: legacy.notes,
              scripts: legacy.scripts,
              flyerUrl,
            }),
          })
          .eq('id', campaignId);

        if (!legacyUpdateError) {
          return NextResponse.json({ flyer_url: flyerUrl });
        }

        console.error('Error saving legacy flyer_url:', legacyUpdateError);
        return NextResponse.json(
          { error: legacyUpdateError.message || 'Failed to save flyer URL' },
          { status: 500 }
        );
      }

      console.error('Error saving flyer_url:', updateError);
      return NextResponse.json({ error: errorMessage }, { status: 500 });
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
