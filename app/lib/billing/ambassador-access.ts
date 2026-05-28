import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest, type RequestUser } from '@/app/api/_utils/request-user';
import {
  ensureAmbassadorReferralCode,
  isMissingAmbassadorSchemaError,
  type SupabaseAdmin,
} from '@/app/lib/billing/ambassador-program';

export type ApprovedAmbassador = {
  id: string;
  full_name: string;
  email: string;
  status: 'approved';
  referral_code: string | null;
  referral_code_max_uses: number | null;
  commission_rate_bps: number;
  commission_duration_months: number | null;
  stripe_payouts_enabled: boolean | null;
};

export type AmbassadorApiContext = {
  admin: SupabaseAdmin;
  requestUser: RequestUser;
  ambassador: ApprovedAmbassador;
};

export function normalizeAmbassadorEmail(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized || null;
}

export async function getApprovedAmbassadorByEmail(
  admin: SupabaseAdmin,
  email: string | null | undefined
): Promise<ApprovedAmbassador | null> {
  const normalizedEmail = normalizeAmbassadorEmail(email);
  if (!normalizedEmail) return null;

  const { data, error } = await admin
    .from('ambassador_applications')
    .select(
      'id, full_name, email, status, referral_code, referral_code_max_uses, commission_rate_bps, commission_duration_months, stripe_payouts_enabled'
    )
    .eq('status', 'approved')
    .ilike('email', normalizedEmail)
    .order('approved_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingAmbassadorSchemaError(error.message)) return null;
    throw new Error(error.message);
  }

  return (data as ApprovedAmbassador | null) ?? null;
}

export async function getApprovedAmbassadorByReferralCode(
  admin: SupabaseAdmin,
  referralCode: string | null | undefined
): Promise<ApprovedAmbassador | null> {
  const normalizedCode = referralCode?.trim();
  if (!normalizedCode) return null;

  const { data, error } = await admin
    .from('ambassador_applications')
    .select(
      'id, full_name, email, status, referral_code, referral_code_max_uses, commission_rate_bps, commission_duration_months, stripe_payouts_enabled'
    )
    .eq('status', 'approved')
    .ilike('referral_code', normalizedCode)
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingAmbassadorSchemaError(error.message)) return null;
    throw new Error(error.message);
  }

  return (data as ApprovedAmbassador | null) ?? null;
}

export async function ensureApprovedAmbassadorReferralCode(
  admin: SupabaseAdmin,
  ambassador: ApprovedAmbassador
): Promise<string> {
  return ensureAmbassadorReferralCode(admin, {
    applicationId: ambassador.id,
    fullName: ambassador.full_name,
    existingReferralCode: ambassador.referral_code,
  });
}

export async function requireApprovedAmbassadorApi(
  request: NextRequest
): Promise<
  | { ok: true; context: AmbassadorApiContext }
  | { ok: false; response: NextResponse }
> {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const admin = createAdminClient();
  const ambassador = await getApprovedAmbassadorByEmail(admin, requestUser.email);
  if (!ambassador) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Ambassador access required' }, { status: 403 }),
    };
  }

  return {
    ok: true,
    context: { admin, requestUser, ambassador },
  };
}
