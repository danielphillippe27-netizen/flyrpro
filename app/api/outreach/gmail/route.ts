import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { createAdminClient } from '@/lib/supabase/server';
import { gmailConfig } from '@/lib/outreach/gmail';
export async function GET(request: NextRequest) {
  const user = await resolveUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  let configured = true;
  try { gmailConfig(); } catch { configured = false; }
  if (!configured) return NextResponse.json({ configured: false, email: null });
  const { data, error } = await createAdminClient().from('personal_gmail_connections').select('email').eq('user_id', user.id).maybeSingle();
  if (error) return NextResponse.json({ error: 'Gmail connection storage is not ready.' }, { status: 503 });
  return NextResponse.json({ configured, email: data?.email ?? null }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function DELETE(request: NextRequest) {
  const user = await resolveUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { error } = await createAdminClient().from('personal_gmail_connections').delete().eq('user_id', user.id);
  if (error) return NextResponse.json({ error: 'Unable to disconnect Gmail.' }, { status: 500 });
  return NextResponse.json({ disconnected: true });
}
