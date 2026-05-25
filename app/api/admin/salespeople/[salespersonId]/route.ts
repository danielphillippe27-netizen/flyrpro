import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireFounderApi } from '@/app/api/admin/_utils/founder';
import {
  ensureSalespersonReferralCode,
  isMissingSalespeopleSchemaError,
} from '@/app/lib/billing/salespeople';

type SalespersonRow = {
  id: string;
  full_name: string;
  referral_code: string | null;
  status: 'active' | 'paused' | 'inactive';
};

const commissionRateBpsSchema = z.preprocess((value) => {
  if (value === '' || value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}, z.number().int().min(1).max(10000).optional());

const updateSalespersonSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().email().max(200).optional(),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  role: z.string().trim().max(120).optional().or(z.literal('')),
  territory: z.string().trim().max(120).optional().or(z.literal('')),
  referralCode: z.string().trim().max(20).optional().or(z.literal('')),
  commissionRateBps: commissionRateBpsSchema,
  commissionDurationMonths: z.preprocess((value) => {
    if (value === '' || value === undefined || value === null) return undefined;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : value;
    }
    return value;
  }, z.number().int().min(1).max(36).optional()),
  status: z.enum(['active', 'paused', 'inactive']).optional(),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
});

function normalizeOptional(value?: string): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ salespersonId: string }> }
) {
  try {
    const auth = await requireFounderApi();
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { salespersonId } = await context.params;
    if (!salespersonId) {
      return NextResponse.json({ error: 'Salesperson ID is required.' }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const parsed = updateSalespersonSchema.safeParse(body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      return NextResponse.json(
        { error: firstIssue?.message ?? 'Invalid salesperson payload.' },
        { status: 400 }
      );
    }

    const { data: existing, error: fetchError } = await auth.admin
      .from('salespeople')
      .select('id, full_name, referral_code, status')
      .eq('id', salespersonId)
      .maybeSingle();

    if (fetchError) {
      if (isMissingSalespeopleSchemaError(fetchError.message)) {
        return NextResponse.json(
          {
            error:
              'Salespeople storage is not ready yet. Run the latest salespeople migration first.',
          },
          { status: 500 }
        );
      }
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    const salesperson = existing as SalespersonRow | null;
    if (!salesperson) {
      return NextResponse.json({ error: 'Salesperson not found.' }, { status: 404 });
    }

    const payload = parsed.data;
    const now = new Date().toISOString();
    const updatePayload: Record<string, string | number | null> = {};

    if (payload.fullName !== undefined) updatePayload.full_name = payload.fullName.trim();
    if (payload.email !== undefined) updatePayload.email = payload.email.trim().toLowerCase();
    const phone = normalizeOptional(payload.phone);
    if (phone !== undefined) updatePayload.phone = phone;
    const role = normalizeOptional(payload.role);
    if (role !== undefined) updatePayload.role = role;
    const territory = normalizeOptional(payload.territory);
    if (territory !== undefined) updatePayload.territory = territory;
    const notes = normalizeOptional(payload.notes);
    if (notes !== undefined) updatePayload.notes = notes;
    if (payload.commissionRateBps !== undefined) {
      updatePayload.commission_rate_bps = payload.commissionRateBps;
    }
    if (payload.commissionDurationMonths !== undefined) {
      updatePayload.commission_duration_months = payload.commissionDurationMonths;
    }
    if (payload.status !== undefined) {
      updatePayload.status = payload.status;
      if (payload.status === 'active') updatePayload.approved_at = now;
      if (payload.status === 'paused') updatePayload.paused_at = now;
      if (payload.status === 'inactive') updatePayload.inactive_at = now;
    }

    if (Object.keys(updatePayload).length > 0) {
      let { error: updateError } = await auth.admin
        .from('salespeople')
        .update(updatePayload)
        .eq('id', salespersonId);

      if (
        updateError &&
        updateError.message.toLowerCase().includes('commission_duration_months') &&
        'commission_duration_months' in updatePayload
      ) {
        delete updatePayload.commission_duration_months;
        const retry = await auth.admin
          .from('salespeople')
          .update(updatePayload)
          .eq('id', salespersonId);
        updateError = retry.error;
      }

      if (updateError) {
        if (isMissingSalespeopleSchemaError(updateError.message)) {
          return NextResponse.json(
            {
              error:
                'Salespeople storage is not ready yet. Run the latest salespeople migration first.',
            },
            { status: 500 }
          );
        }
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }
    }

    const referralCode =
      payload.referralCode !== undefined
        ? await ensureSalespersonReferralCode(auth.admin, {
            salespersonId,
            fullName: payload.fullName ?? salesperson.full_name,
            existingReferralCode: salesperson.referral_code,
            preferredReferralCode: payload.referralCode,
          })
        : salesperson.referral_code;

    return NextResponse.json({ ok: true, referralCode });
  } catch (error) {
    console.error('[api/admin/salespeople/:salespersonId] PATCH error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
