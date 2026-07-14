import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';

function splitName(fullName: string): { firstName: string | null; lastName: string | null } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get('token')?.trim();
    if (!token) {
      return NextResponse.json({ error: 'Invite token is required' }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from('salespeople')
      .select('id, full_name, email, status, invite_token, workspace_id, onboarding_completed_at')
      .eq('invite_token', token)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data || data.status !== 'active') {
      return NextResponse.json({ valid: false }, { status: 404 });
    }

    const { firstName, lastName } = splitName(data.full_name ?? '');

    return NextResponse.json({
      valid: true,
      salespersonId: data.id,
      fullName: data.full_name,
      firstName,
      lastName,
      email: data.email,
      workspaceName: `WolfGrid / Salespeople / ${data.full_name}`,
      completed: Boolean(data.workspace_id || data.onboarding_completed_at),
    });
  } catch (error) {
    console.error('[api/salesperson-invites/validate] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
