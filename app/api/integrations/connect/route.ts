import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const allowedProviders = new Set(['followupboss', 'hubspot', 'monday', 'kvcore', 'zapier']);

export async function POST(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const providerId = typeof body.providerId === 'string' ? body.providerId.trim() : '';
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  if (!allowedProviders.has(providerId) || !apiKey) {
    return NextResponse.json({ error: 'providerId and apiKey are required' }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from('user_integrations')
    .upsert(
      {
        user_id: requestUser.id,
        provider: providerId,
        api_key: apiKey,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,provider' }
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
