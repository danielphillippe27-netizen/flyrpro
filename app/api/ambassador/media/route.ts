import { NextRequest, NextResponse } from 'next/server';
import { requireApprovedAmbassadorApi } from '@/app/lib/billing/ambassador-access';
import { getOrCreateAmbassadorLandingPage } from '@/app/lib/ambassador/landing-page';
import { buildPublicLandingPath, withFlyrOrigin } from '@/app/lib/ambassador/portal';
import type { SupabaseAdmin } from '@/app/lib/billing/ambassador-program';

const BUCKET = 'ambassador-media';
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v'];
const IMAGE_MAX_SIZE_MB = 8;
const VIDEO_MAX_SIZE_MB = 250;

type MediaKind = 'photo' | 'video';

function serializeLandingPage(row: Awaited<ReturnType<typeof getOrCreateAmbassadorLandingPage>>) {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    headline: row.headline,
    introMessage: row.intro_message,
    profileImageUrl: row.profile_image_url,
    heroVideoUrl: row.hero_video_url,
    audienceType: row.audience_type,
    ctaText: row.cta_text,
    offerText: row.offer_text,
    isPublished: row.is_published,
    publicUrl: withFlyrOrigin(buildPublicLandingPath(row.slug)),
  };
}

function safeExtension(fileName: string, contentType: string, kind: MediaKind) {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const allowed =
    kind === 'photo'
      ? ['jpg', 'jpeg', 'png', 'webp', 'gif']
      : ['mp4', 'webm', 'mov', 'm4v'];

  if (ext && allowed.includes(ext)) return ext;
  if (kind === 'photo') {
    if (contentType === 'image/png') return 'png';
    if (contentType === 'image/webp') return 'webp';
    if (contentType === 'image/gif') return 'gif';
    return 'jpg';
  }

  if (contentType === 'video/webm') return 'webm';
  if (contentType === 'video/quicktime') return 'mov';
  if (contentType === 'video/x-m4v') return 'm4v';
  return 'mp4';
}

function validateMedia(kind: MediaKind, contentType: string, size: number) {
  const allowedTypes = kind === 'photo' ? IMAGE_TYPES : VIDEO_TYPES;
  if (!allowedTypes.includes(contentType)) {
    return kind === 'photo'
      ? 'Use a JPEG, PNG, WebP, or GIF image.'
      : 'Use an MP4, WebM, MOV, or M4V video.';
  }

  const maxSize = (kind === 'photo' ? IMAGE_MAX_SIZE_MB : VIDEO_MAX_SIZE_MB) * 1024 * 1024;
  if (size > maxSize) {
    return `File too large. Maximum size is ${kind === 'photo' ? IMAGE_MAX_SIZE_MB : VIDEO_MAX_SIZE_MB}MB.`;
  }

  return null;
}

function publicUrlForPath(admin: SupabaseAdmin, path: string) {
  return admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireApprovedAmbassadorApi(request);
    if (!auth.ok) return auth.response;

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return NextResponse.json(
        { error: 'Media uploads now use signed direct uploads. Please refresh and try again.' },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid upload request.' }, { status: 400 });
    }

    const { admin, ambassador } = auth.context;
    const action = String((body as { action?: unknown }).action ?? '');
    const kind = (body as { kind?: unknown }).kind;
    if (kind !== 'photo' && kind !== 'video') {
      return NextResponse.json({ error: 'Choose photo or video.' }, { status: 400 });
    }

    if (action === 'prepare') {
      const fileName = String((body as { fileName?: unknown }).fileName ?? '').trim();
      const uploadContentType = String((body as { contentType?: unknown }).contentType ?? '').trim();
      const size = Number((body as { size?: unknown }).size ?? 0);
      if (!fileName || !uploadContentType || !Number.isFinite(size) || size <= 0) {
        return NextResponse.json({ error: 'Missing upload file details.' }, { status: 400 });
      }

      const validationError = validateMedia(kind, uploadContentType, size);
      if (validationError) {
        return NextResponse.json({ error: validationError }, { status: 400 });
      }

      const ext = safeExtension(fileName, uploadContentType, kind);
      const path = `${ambassador.id}/${kind}/${crypto.randomUUID()}.${ext}`;
      const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error || !data?.token) {
        console.error('[api/ambassador/media] signed upload error:', error);
        return NextResponse.json({ error: error?.message || 'Could not create upload URL.' }, { status: 500 });
      }

      return NextResponse.json({
        bucket: BUCKET,
        path: data.path,
        token: data.token,
        publicUrl: publicUrlForPath(admin, data.path),
      });
    }

    if (action === 'complete') {
      const path = String((body as { path?: unknown }).path ?? '').trim();
      const expectedPrefix = `${ambassador.id}/${kind}/`;
      if (!path || !path.startsWith(expectedPrefix)) {
        return NextResponse.json({ error: 'Invalid uploaded media path.' }, { status: 400 });
      }

      const current = await getOrCreateAmbassadorLandingPage(admin, ambassador);
      const url = publicUrlForPath(admin, path);
      const { data, error } = await admin
        .from('ambassador_landing_pages')
        .update({
          profile_image_url: kind === 'photo' ? url : current.profile_image_url,
          hero_video_url: kind === 'video' ? url : current.hero_video_url,
          updated_at: new Date().toISOString(),
        })
        .eq('id', current.id)
        .eq('ambassador_application_id', ambassador.id)
        .select(
          'id, ambassador_application_id, slug, display_name, headline, intro_message, profile_image_url, hero_video_url, audience_type, cta_text, offer_text, is_published, created_at, updated_at'
        )
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        url,
        kind,
        landingPage: serializeLandingPage(data),
      });
    }

    return NextResponse.json({ error: 'Invalid media upload action.' }, { status: 400 });
  } catch (error) {
    console.error('[api/ambassador/media] POST error:', error);
    return NextResponse.json({ error: 'Failed to upload media.' }, { status: 500 });
  }
}
