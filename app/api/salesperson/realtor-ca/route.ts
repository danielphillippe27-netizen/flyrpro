import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { createAdminClient } from '@/lib/supabase/server';
import { captureAndExtractRealtorCaScreenshots } from '@/lib/scraper/realtorCaScreenshotPageSearch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type SalespersonRow = {
  id: string;
  full_name: string;
  email: string;
  workspace_id: string | null;
};

const requestSchema = z.object({
  city: z.string().trim().min(2).max(100),
  provinceCode: z.string().trim().min(2).max(2).default('on'),
  maxPages: z.number().int().min(1).max(12).default(1),
  maxProfiles: z.number().int().min(1).max(500).default(100),
  delayMs: z.number().int().min(0).max(10_000).default(1500),
});

async function resolveSalesperson(
  admin: ReturnType<typeof createAdminClient>,
  email: string | null
): Promise<SalespersonRow | null> {
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) return null;

  const { data, error } = await admin
    .from('salespeople')
    .select('id, full_name, email, workspace_id')
    .eq('email', normalizedEmail)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as SalespersonRow | null) ?? null;
}

async function isFounderUser(
  admin: ReturnType<typeof createAdminClient>,
  userId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from('user_profiles')
    .select('user_id, is_founder')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return Boolean((data as { is_founder?: boolean | null } | null)?.is_founder);
}

export async function POST(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return NextResponse.json(
      { error: firstIssue?.message ?? 'Invalid REALTOR.ca scraper settings.' },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  try {
    const [salesperson, isFounder] = await Promise.all([
      resolveSalesperson(admin, requestUser.email),
      isFounderUser(admin, requestUser.id),
    ]);

    if (!salesperson && !isFounder) {
      return NextResponse.json(
        { error: 'Salesperson access is required for REALTOR.ca lead search.' },
        { status: 403 }
      );
    }

    const result = await captureAndExtractRealtorCaScreenshots(parsed.data);
    return NextResponse.json({
      ok: true,
      salesperson: salesperson
        ? {
            id: salesperson.id,
            fullName: salesperson.full_name,
            email: salesperson.email,
            workspaceId: salesperson.workspace_id,
          }
        : null,
      leadSource: 'realtor_ca_screenshot',
      savedList: null,
      ...result,
    });
  } catch (error) {
    console.error('[api/salesperson/realtor-ca] POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'REALTOR.ca lead search failed.' },
      { status: 500 }
    );
  }
}
