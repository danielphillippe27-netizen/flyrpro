import { NextRequest, NextResponse } from 'next/server';
import type { DialerCall } from '@/types/database';
import { getDialerRequestContext } from '@/lib/dialer/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ callId: string }> }
) {
  const { callId } = await params;
  const workspaceId = request.nextUrl.searchParams.get('workspaceId') ?? undefined;
  const context = await getDialerRequestContext(request, workspaceId);

  if (context instanceof NextResponse) {
    return context;
  }

  const { data: call, error } = await context.admin
    .from('dialer_calls')
    .select('*')
    .eq('id', callId)
    .eq('workspace_id', context.workspaceId)
    .eq('user_id', context.requestUser.id)
    .maybeSingle();

  if (error) {
    console.error('[dialer/calls/get] failed to load call', error);
    return NextResponse.json({ error: 'Failed to load call details' }, { status: 500 });
  }

  if (!call) {
    return NextResponse.json({ error: 'Call not found' }, { status: 404 });
  }

  return NextResponse.json({ call: call as DialerCall });
}
