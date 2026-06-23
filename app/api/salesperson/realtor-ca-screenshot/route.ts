import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { createAdminClient } from '@/lib/supabase/server';
import { extractRealtorCaScreenshotLeads } from '@/lib/scraper/realtorCaScreenshotExtraction';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type SalespersonRow = {
  id: string;
  full_name: string;
  email: string;
  workspace_id: string | null;
};

const formSchema = z.object({
  city: z.string().trim().min(2).max(100),
  provinceCode: z.string().trim().min(2).max(2).default('on'),
});

const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

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

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: 'Invalid screenshot upload.' }, { status: 400 });
  }

  const parsed = formSchema.safeParse({
    city: formData.get('city')?.toString() ?? '',
    provinceCode: formData.get('provinceCode')?.toString() ?? 'on',
  });
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return NextResponse.json(
      { error: firstIssue?.message ?? 'Invalid screenshot extraction settings.' },
      { status: 400 }
    );
  }

  const files = formData.getAll('images').filter((item): item is File => item instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: 'Upload at least one screenshot.' }, { status: 400 });
  }
  if (files.length > MAX_IMAGES) {
    return NextResponse.json({ error: `Upload ${MAX_IMAGES} screenshots or fewer at a time.` }, { status: 400 });
  }

  let images: Array<{ filename: string; mediaType: string; base64: string }>;
  try {
    images = await Promise.all(
      files.map(async (file) => {
        if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
          throw new Error('Only PNG, JPEG, or WebP screenshots are supported.');
        }
        if (file.size > MAX_IMAGE_BYTES) {
          throw new Error(`"${file.name}" is too large. Keep each screenshot under 8 MB.`);
        }
        const buffer = Buffer.from(await file.arrayBuffer());
        return {
          filename: file.name || 'realtor-ca-screenshot',
          mediaType: file.type,
          base64: buffer.toString('base64'),
        };
      })
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Could not read screenshot files.' },
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
        { error: 'Salesperson access is required for REALTOR.ca screenshot import.' },
        { status: 403 }
      );
    }

    const result = await extractRealtorCaScreenshotLeads({
      city: parsed.data.city,
      provinceCode: parsed.data.provinceCode,
      images,
    });

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
    console.error('[api/salesperson/realtor-ca-screenshot] POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'REALTOR.ca screenshot extraction failed.' },
      { status: 500 }
    );
  }
}
