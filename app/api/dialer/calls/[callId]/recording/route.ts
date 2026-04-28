import { NextRequest, NextResponse } from 'next/server';
import type { DialerCall } from '@/types/database';
import { getDialerRequestContext } from '@/lib/dialer/server';
import { getTwilioAccountSid, getTwilioAuthToken } from '@/lib/dialer/env';
import { getDialerCallRecording } from '@/lib/dialer/recordings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ callId: string }> }
) {
  const workspaceId = request.nextUrl.searchParams.get('workspaceId');
  const { callId } = await params;

  const context = await getDialerRequestContext(request, workspaceId);
  if (context instanceof NextResponse) {
    return context;
  }

  const { data: call, error } = await context.admin
    .from('dialer_calls')
    .select('*')
    .eq('id', callId)
    .eq('workspace_id', context.workspaceId)
    .maybeSingle();

  if (error) {
    console.error('[dialer/recording] failed to load call', error);
    return NextResponse.json({ error: 'Failed to load call details' }, { status: 500 });
  }

  if (!call) {
    return NextResponse.json({ error: 'Call not found' }, { status: 404 });
  }

  const recording = getDialerCallRecording(call as DialerCall);
  if (!recording?.mp3Url) {
    return NextResponse.json({ error: 'Recording is not available yet' }, { status: 404 });
  }

  const basicAuth = Buffer.from(`${getTwilioAccountSid()}:${getTwilioAuthToken()}`).toString('base64');
  const mediaResponse = await fetch(recording.mp3Url, {
    headers: {
      Authorization: `Basic ${basicAuth}`,
    },
    cache: 'no-store',
  });

  if (!mediaResponse.ok || !mediaResponse.body) {
    return NextResponse.json({ error: 'Unable to fetch recording audio' }, { status: 502 });
  }

  return new NextResponse(mediaResponse.body, {
    status: 200,
    headers: {
      'Content-Type': mediaResponse.headers.get('content-type') ?? 'audio/mpeg',
      'Cache-Control': 'private, no-store',
    },
  });
}
