import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceMembershipForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';
import { countBoundaryAddresses } from '@/lib/territory/count-boundary-addresses';

export const runtime = 'nodejs';
export const maxDuration = 180;
export async function POST(request: NextRequest) {
  const user = await resolveUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const admin = createAdminClient();
  const member = await resolveWorkspaceMembershipForUser(admin as unknown as MinimalSupabaseClient, user.id, request.nextUrl.searchParams.get('workspaceId'));
  if (!member.workspaceId) return NextResponse.json({ error: 'Workspace access required' }, { status: 403 });
  return countBoundaryAddresses(request, member.workspaceId);
}
