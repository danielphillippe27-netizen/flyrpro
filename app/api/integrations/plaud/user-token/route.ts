import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { recordingAccess, recordingError } from '@/lib/field-recordings/access';
import { issuePlaudUserToken, plaudBaseUrl } from '@/lib/field-recordings/plaud';

export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  try {
    const input = z.object({ workspaceId: z.uuid() }).strict().safeParse(await request.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: 'Select a workspace' }, { status: 400 });
    const { user, workspaceId } = await recordingAccess(request, input.data.workspaceId);
    const token = await issuePlaudUserToken(`wolfgrid:${workspaceId}:${user.id}`);
    return NextResponse.json({ ...token, userId: `wolfgrid:${workspaceId}:${user.id}`, domain: new URL(plaudBaseUrl()).hostname }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return recordingError(error); }
}
