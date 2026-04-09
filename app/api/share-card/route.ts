import { ImageResponse } from 'next/og';
import { NextRequest, NextResponse } from 'next/server';
import { getShareCardData } from '@/lib/challenges/card-data';
import { renderShareCard } from '@/lib/challenges/card-render';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

type ShareCardRequestParams = {
  userId: string | null;
  challengeId: string | null;
  sessionId: string | null;
};

function buildStoragePath(userId: string, challengeId: string, sessionId: string) {
  return `${userId}/${challengeId}/${sessionId}.png`;
}

async function ensureShareCard(params: {
  userId: string;
  challengeId?: string | null;
  sessionId: string;
}) {
  const admin = createAdminClient();
  const shareData = await getShareCardData(params);
  const objectPath = buildStoragePath(params.userId, shareData.challenge.id, params.sessionId);
  const folder = `${params.userId}/${shareData.challenge.id}`;
  const fileName = `${params.sessionId}.png`;

  const { data: existingFiles } = await admin.storage
    .from('share-cards')
    .list(folder, { search: fileName, limit: 1 });

  if (existingFiles?.some((entry) => entry.name === fileName)) {
    const publicUrl = admin.storage.from('share-cards').getPublicUrl(objectPath).data.publicUrl;
    return { objectPath, publicUrl, challenge: shareData.challenge };
  }

  const image = new ImageResponse(renderShareCard({
    displayName: shareData.displayName,
    homesToday: shareData.homesToday,
    rank: shareData.rank,
    participantCount: shareData.participantCount,
    dayInChallenge: shareData.dayInChallenge,
    totalDays: shareData.challenge.duration_days,
  }), {
    width: 1080,
    height: 1920,
  });

  const arrayBuffer = await image.arrayBuffer();
  const { error: uploadError } = await admin.storage
    .from('share-cards')
    .upload(objectPath, arrayBuffer, {
      contentType: 'image/png',
      upsert: true,
      cacheControl: '3600',
    });
  if (uploadError) throw uploadError;

  const publicUrl = admin.storage.from('share-cards').getPublicUrl(objectPath).data.publicUrl;
  return { objectPath, publicUrl, challenge: shareData.challenge, arrayBuffer };
}

async function requestParams(request: NextRequest): Promise<ShareCardRequestParams> {
  if (request.method === 'GET') {
    return {
      userId: request.nextUrl.searchParams.get('user_id'),
      challengeId: request.nextUrl.searchParams.get('challenge_id'),
      sessionId: request.nextUrl.searchParams.get('session_id'),
    };
  }

  const raw = await request.json().catch(() => ({}));
  const body = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  return {
    userId:
      typeof body.userId === 'string'
        ? body.userId
        : typeof body.user_id === 'string'
          ? body.user_id
          : null,
    challengeId:
      typeof body.challengeId === 'string'
        ? body.challengeId
        : typeof body.challenge_id === 'string'
          ? body.challenge_id
          : null,
    sessionId:
      typeof body.sessionId === 'string'
        ? body.sessionId
        : typeof body.session_id === 'string'
          ? body.session_id
          : null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { userId, challengeId, sessionId } = await requestParams(request);

    if (!userId || !sessionId) {
      return NextResponse.json({ error: 'user_id and session_id are required' }, { status: 400 });
    }

    const { publicUrl } = await ensureShareCard({ userId, challengeId, sessionId });
    return NextResponse.redirect(publicUrl, 302);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate share card';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId, challengeId, sessionId } = await requestParams(request);

    if (!userId || !sessionId) {
      return NextResponse.json({ error: 'user_id and session_id are required' }, { status: 400 });
    }

    const ensured = await ensureShareCard({ userId, challengeId, sessionId });
    const arrayBuffer = ensured.arrayBuffer ??
      await fetch(ensured.publicUrl).then((res) => res.arrayBuffer());

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        'X-Share-Card-Url': ensured.publicUrl,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate share card';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
