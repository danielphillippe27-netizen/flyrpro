import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { realtorCaInboundConfigured, realtorCaInboundDomain } from '@/lib/email/realtor-ca';
import { createAdminClient } from '@/lib/supabase/server';

async function manageAddress(request: NextRequest) {
  const user = await resolveUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = request.nextUrl.searchParams.get('workspaceId') ?? '';
  if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(workspaceId)) {
    return NextResponse.json({ error: 'Select a workspace first.' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: member, error: memberError } = await admin.from('workspace_members')
    .select('user_id').eq('workspace_id', workspaceId).eq('user_id', user.id).maybeSingle();
  if (memberError) return NextResponse.json({ error: 'Could not check workspace access.' }, { status: 500 });
  if (!member) return NextResponse.json({ error: 'Workspace unavailable.' }, { status: 403 });

  const routes = admin.from('realtor_ca_email_routes');
  if (request.method === 'DELETE') {
    const { error } = await routes.delete().eq('user_id', user.id).eq('workspace_id', workspaceId);
    if (error) return NextResponse.json({ error: 'Could not disable forwarding.' }, { status: 500 });
    return NextResponse.json({ address: null, available: realtorCaInboundConfigured() });
  }

  const available = realtorCaInboundConfigured();
  if (request.method === 'POST') {
    if (!available) return NextResponse.json({ error: 'Inbound email is unavailable.' }, { status: 503 });
    const { error } = await routes.upsert({ workspace_id: workspaceId, user_id: user.id }, {
      onConflict: 'workspace_id,user_id',
      ignoreDuplicates: true,
    });
    if (error) return NextResponse.json({ error: 'Could not create a forwarding address.' }, { status: 500 });
  }

  const { data, error } = await routes.select('token, verification_code, verification_received_at')
    .eq('user_id', user.id).eq('workspace_id', workspaceId).maybeSingle();
  if (error) return NextResponse.json({ error: 'Could not load the forwarding address.' }, { status: 500 });
  return NextResponse.json({
    address: data?.token ? `realtorca-${data.token}@${realtorCaInboundDomain()}` : null,
    available,
    verificationCode: data?.verification_received_at &&
      Date.now() - Date.parse(data.verification_received_at) < 30 * 60 * 1000
      ? data.verification_code
      : null,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export const GET = manageAddress;
export const POST = manageAddress;
export const DELETE = manageAddress;
