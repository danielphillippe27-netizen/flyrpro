import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SettingsBody = {
  fullName?: string;
  notificationsEnabled?: boolean;
};

type SettingsRow = {
  first_name?: string | null;
  last_name?: string | null;
  notification_settings?: { enabled?: boolean } | null;
};

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return {
    first_name: parts[0] ?? null,
    last_name: parts.length > 1 ? parts.slice(1).join(' ') : null,
  };
}

export async function GET(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  let result = await admin
    .from('user_profiles')
    .select('first_name, last_name, notification_settings')
    .eq('user_id', requestUser.id)
    .maybeSingle();

  if (result.error && result.error.message.toLowerCase().includes('notification_settings')) {
    result = await admin
      .from('user_profiles')
      .select('first_name, last_name')
      .eq('user_id', requestUser.id)
      .maybeSingle();
  }

  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  const data = result.data as SettingsRow | null;
  const notificationSettings = data?.notification_settings ?? {};
  return NextResponse.json({
    fullName: [data?.first_name, data?.last_name].filter(Boolean).join(' '),
    notificationsEnabled: notificationSettings.enabled ?? true,
  });
}

export async function POST(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as SettingsBody;
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
  const updates: Record<string, unknown> = {
    ...splitName(fullName),
    notification_settings: { enabled: body.notificationsEnabled ?? true },
  };

  const admin = createAdminClient();
  let result = await admin
    .from('user_profiles')
    .upsert({ user_id: requestUser.id, ...updates }, { onConflict: 'user_id' })
    .select('first_name, last_name, notification_settings')
    .single();

  if (result.error && result.error.message.toLowerCase().includes('notification_settings')) {
    delete updates.notification_settings;
    result = await admin
      .from('user_profiles')
      .upsert({ user_id: requestUser.id, ...updates }, { onConflict: 'user_id' })
      .select('first_name, last_name')
      .single();
  }

  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  const data = result.data as SettingsRow;
  const notificationSettings = data.notification_settings ?? {};
  return NextResponse.json({
    fullName: [data.first_name, data.last_name].filter(Boolean).join(' '),
    notificationsEnabled: notificationSettings.enabled ?? true,
  });
}
