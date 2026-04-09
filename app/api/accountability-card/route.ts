import { ImageResponse } from 'next/og';
import { NextRequest, NextResponse } from 'next/server';
import { getAccountabilityCardData } from '@/lib/challenges/card-data';
import { renderAccountabilityCard } from '@/lib/challenges/card-render';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

type AccountabilityCardRequestParams = {
  userId: string | null;
  challengeId: string | null;
  referenceDate: string | null;
};

function weeklyStoragePath(userId: string, isoWeek: string) {
  return `${userId}/weekly/${isoWeek}.png`;
}

async function ensureAccountabilityCard(params: {
  userId: string;
  challengeId?: string | null;
  referenceDate?: Date;
}) {
  const admin = createAdminClient();
  const data = await getAccountabilityCardData(params);
  const objectPath = weeklyStoragePath(params.userId, data.isoWeek);
  const folder = `${params.userId}/weekly`;
  const fileName = `${data.isoWeek}.png`;

  const { data: existingFiles } = await admin.storage
    .from('share-cards')
    .list(folder, { search: fileName, limit: 1 });

  if (!existingFiles?.some((entry) => entry.name === fileName)) {
    const image = new ImageResponse(renderAccountabilityCard({
      headerLabel: data.headerLabel,
      doorsThisWeek: data.doorsThisWeek,
      conversationsThisWeek: data.conversationsThisWeek,
      appointmentsThisWeek: data.appointmentsThisWeek,
      nextWeekGoal: data.nextWeekGoal,
      hashtags: data.hashtags,
    }), {
      width: 1080,
      height: 1920,
    });

    const buffer = await image.arrayBuffer();
    const { error: uploadError } = await admin.storage
      .from('share-cards')
      .upload(objectPath, buffer, {
        contentType: 'image/png',
        upsert: true,
        cacheControl: '3600',
      });
    if (uploadError) throw uploadError;
  }

  const publicUrl = admin.storage.from('share-cards').getPublicUrl(objectPath).data.publicUrl;

  const { error: postError } = await admin
    .from('accountability_posts')
    .upsert(
      {
        user_id: params.userId,
        challenge_id: data.challenge.id,
        week_start: data.weekStart,
        iso_week: data.isoWeek,
        timezone: data.timezone,
        doors_this_week: data.doorsThisWeek,
        conversations_this_week: data.conversationsThisWeek,
        appointments_this_week: data.appointmentsThisWeek,
        next_week_goal: data.nextWeekGoal,
        card_path: objectPath,
        card_public_url: publicUrl,
      },
      { onConflict: 'user_id,challenge_id,week_start' },
    );
  if (postError) throw postError;

  return { publicUrl, objectPath, data };
}

async function rawParams(request: NextRequest): Promise<AccountabilityCardRequestParams> {
  if (request.method === 'GET') {
    return {
      userId: request.nextUrl.searchParams.get('user_id'),
      challengeId: request.nextUrl.searchParams.get('challenge_id'),
      referenceDate: request.nextUrl.searchParams.get('reference_date'),
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
    referenceDate:
      typeof body.referenceDate === 'string'
        ? body.referenceDate
        : typeof body.reference_date === 'string'
          ? body.reference_date
          : null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { userId, challengeId, referenceDate: rawReferenceDate } = await rawParams(request);
    const referenceDate = rawReferenceDate ? new Date(rawReferenceDate) : undefined;

    if (!userId) {
      return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
    }

    const { publicUrl } = await ensureAccountabilityCard({ userId, challengeId, referenceDate });
    return NextResponse.redirect(publicUrl, 302);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate accountability card';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId, challengeId, referenceDate: rawReferenceDate } = await rawParams(request);
    const referenceDate = rawReferenceDate ? new Date(rawReferenceDate) : undefined;

    if (!userId) {
      return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
    }

    const { publicUrl } = await ensureAccountabilityCard({ userId, challengeId, referenceDate });
    const arrayBuffer = await fetch(publicUrl).then((res) => res.arrayBuffer());

    return new NextResponse(arrayBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        'X-Accountability-Card-Url': publicUrl,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to generate accountability card';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
