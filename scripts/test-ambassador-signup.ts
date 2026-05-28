import { equal, ok } from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local', override: true });

type JsonObject = Record<string, unknown>;

const appUrl =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'http://localhost:3000';
const supabaseUrl =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const keepTestData = process.env.SMOKE_KEEP_TEST_USER === '1';

function requireEnv(name: string, value: string) {
  if (!value) {
    throw new Error(`${name} is required. Check .env.local.`);
  }
}

function normalizeReferralCode(value: string): string {
  return value
    .toUpperCase()
    .replace(/&/g, 'AND')
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 20);
}

async function readJson(response: Response): Promise<JsonObject> {
  return (await response.json().catch(() => ({}))) as JsonObject;
}

async function assertLocalAppIsRunning() {
  const response = await fetch(`${appUrl}/onboarding`, {
    method: 'GET',
    redirect: 'manual',
  }).catch((error: unknown) => {
    throw new Error(
      `Could not reach ${appUrl}. Start the app with "npm run dev" first. ${
        error instanceof Error ? error.message : ''
      }`
    );
  });

  if (!response.ok) {
    throw new Error(`Local app returned ${response.status} for /onboarding.`);
  }
}

async function main() {
  requireEnv('NEXT_PUBLIC_SUPABASE_URL', supabaseUrl);
  requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', supabaseAnonKey);
  requireEnv('SUPABASE_SERVICE_ROLE_KEY', supabaseServiceRoleKey);

  await assertLocalAppIsRunning();

  const admin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anon = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const runId = randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
  const referralCode = normalizeReferralCode(`SMOKE${runId}`);
  const referralSource = 'smoke-source';
  const referralCampaign = `smoke-${runId.toLowerCase()}`;
  const maxedReferralCode = normalizeReferralCode(`FULL${runId}`);
  const email = `flyr-smoke-${runId.toLowerCase()}@example.com`;
  const password = `Smoke-${runId}-12345!`;
  let ambassadorApplicationId: string | null = null;
  let maxedAmbassadorApplicationId: string | null = null;
  let userId: string | null = null;
  const workspaceIds = new Set<string>();

  try {
    const { data: ambassador, error: ambassadorError } = await admin
      .from('ambassador_applications')
      .insert({
        full_name: 'Smoke Test Ambassador',
        email: `ambassador-${runId.toLowerCase()}@example.com`,
        primary_niche: 'Real Estate',
        primary_platform: 'Test',
        why_flyr: 'Automated signup smoke test ambassador.',
        status: 'approved',
        approved_at: new Date().toISOString(),
        referral_code: referralCode,
        referral_code_max_uses: 25,
        commission_rate_bps: 2500,
        commission_duration_months: 12,
      })
      .select('id')
      .single();

    if (ambassadorError || !ambassador?.id) {
      throw new Error(
        `Failed to create test ambassador: ${
          ambassadorError?.message ?? 'missing inserted row'
        }`
      );
    }
    ambassadorApplicationId = ambassador.id;

    const invalidValidationResponse = await fetch(`${appUrl}/api/onboarding/referral-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referralCode: `NOPE${runId}` }),
    });
    const invalidValidationPayload = await readJson(invalidValidationResponse);
    equal(invalidValidationResponse.ok, false, 'Invalid code should not validate.');
    equal(invalidValidationPayload.valid, false);

    const { data: maxedAmbassador, error: maxedAmbassadorError } = await admin
      .from('ambassador_applications')
      .insert({
        full_name: 'Smoke Test Maxed Ambassador',
        email: `maxed-ambassador-${runId.toLowerCase()}@example.com`,
        primary_niche: 'Real Estate',
        primary_platform: 'Test',
        why_flyr: 'Automated maxed referral smoke test ambassador.',
        status: 'approved',
        approved_at: new Date().toISOString(),
        referral_code: maxedReferralCode,
        referral_code_max_uses: 1,
        commission_rate_bps: 2500,
        commission_duration_months: 12,
      })
      .select('id')
      .single();

    if (maxedAmbassadorError || !maxedAmbassador?.id) {
      throw new Error(
        `Failed to create maxed test ambassador: ${
          maxedAmbassadorError?.message ?? 'missing inserted row'
        }`
      );
    }
    maxedAmbassadorApplicationId = maxedAmbassador.id;

    const signUp = await anon.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: 'Signup',
          last_name: 'Smoke',
          country_code: 'US',
        },
      },
    });

    if (signUp.error) {
      throw new Error(`Supabase signup failed: ${signUp.error.message}`);
    }
    userId = signUp.data.user?.id ?? null;
    ok(userId, 'Signup did not return a user id.');

    const { data: maxedWorkspace, error: maxedWorkspaceError } = await admin
      .from('workspaces')
      .insert({
        name: `Maxed Referral Workspace ${runId}`,
        owner_id: userId,
        referral_code_used: maxedReferralCode,
      })
      .select('id')
      .single();

    if (maxedWorkspaceError || !maxedWorkspace?.id) {
      throw new Error(
        `Failed to create maxed referral workspace: ${
          maxedWorkspaceError?.message ?? 'missing workspace id'
        }`
      );
    }
    workspaceIds.add(maxedWorkspace.id);

    const maxedValidationResponse = await fetch(`${appUrl}/api/onboarding/referral-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referralCode: maxedReferralCode }),
    });
    const maxedValidationPayload = await readJson(maxedValidationResponse);
    equal(maxedValidationResponse.ok, false, 'Maxed code should not validate.');
    equal(maxedValidationPayload.reason, 'maxed');

    let session = signUp.data.session;
    if (!session) {
      const { error: confirmError } = await admin.auth.admin.updateUserById(userId, {
        email_confirm: true,
      });
      if (confirmError) {
        throw new Error(`Could not confirm smoke-test user: ${confirmError.message}`);
      }

      const signedIn = await anon.auth.signInWithPassword({ email, password });
      if (signedIn.error || !signedIn.data.session) {
        throw new Error(
          `Smoke-test user could not sign in after signup: ${
            signedIn.error?.message ?? 'missing session'
          }`
        );
      }
      session = signedIn.data.session;
    }

    const completeResponse = await fetch(`${appUrl}/api/onboarding/complete`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        firstName: 'Signup',
        lastName: 'Smoke',
        countryCode: 'US',
        workspaceName: `Smoke Workspace ${runId}`,
        industry: 'Real Estate',
        referralCode,
        referralSource,
        referralCampaign,
        useCase: 'solo',
        maxSeats: 1,
      }),
    });

    const completePayload = await readJson(completeResponse);
    if (!completeResponse.ok) {
      throw new Error(
        `Onboarding complete failed (${completeResponse.status}): ${
          String(completePayload.error ?? 'unknown error')
        }`
      );
    }

    equal(completePayload.success, true, 'Onboarding response did not succeed.');

    const { data: memberships, error: membershipError } = await admin
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('user_id', userId)
      .eq('role', 'owner');

    if (membershipError) {
      throw new Error(`Could not load workspace membership: ${membershipError.message}`);
    }

    for (const membership of memberships ?? []) {
      if (typeof membership.workspace_id === 'string') {
        workspaceIds.add(membership.workspace_id);
      }
    }
    ok(workspaceIds.size > 0, 'No owner workspace was created.');

    const { data: workspaces, error: workspaceError } = await admin
      .from('workspaces')
      .select(
        'id, name, referral_code_used, subscription_status, trial_ends_at, onboarding_completed_at, max_seats'
      )
      .in('id', Array.from(workspaceIds));

    if (workspaceError) {
      throw new Error(`Could not load workspace: ${workspaceError.message}`);
    }

    const workspace = (workspaces ?? []).find(
      (row) => row.referral_code_used === referralCode
    );
    ok(workspace, 'No workspace stored the ambassador referral code.');
    equal(workspace.subscription_status, 'trialing');
    ok(workspace.trial_ends_at, 'Workspace trial end was not set.');
    {
      const trialMs = new Date(workspace.trial_ends_at).getTime() - Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      ok(trialMs > 29 * dayMs, 'Ambassador trial should be close to 30 days.');
      ok(trialMs <= 31 * dayMs, 'Ambassador trial should not exceed about 30 days.');
    }
    ok(
      workspace.onboarding_completed_at,
      'Workspace onboarding completion timestamp was not set.'
    );
    equal(workspace.max_seats, 1);

    const { data: referral, error: referralError } = await admin
      .from('ambassador_referrals')
      .select(
        'id, ambassador_application_id, referred_user_id, referred_workspace_id, referral_code, status, source, campaign'
      )
      .eq('referred_workspace_id', workspace.id)
      .maybeSingle();

    if (referralError) {
      throw new Error(`Could not load ambassador referral: ${referralError.message}`);
    }

    ok(referral?.id, 'Ambassador referral attribution row was not created.');
    equal(referral.ambassador_application_id, ambassadorApplicationId);
    equal(referral.referred_user_id, userId);
    equal(referral.referred_workspace_id, workspace.id);
    equal(referral.referral_code, referralCode);
    equal(referral.status, 'attributed');
    equal(referral.source, referralSource);
    equal(referral.campaign, referralCampaign);

    const { data: userProfile, error: userProfileError } = await admin
      .from('user_profiles')
      .select('user_id, current_workspace_id, first_name, last_name, country_code')
      .eq('user_id', userId)
      .maybeSingle();

    if (userProfileError) {
      throw new Error(`Could not load user profile: ${userProfileError.message}`);
    }

    equal(userProfile?.first_name, 'Signup');
    equal(userProfile?.last_name, 'Smoke');
    equal(userProfile?.country_code, 'US');

    console.log('Ambassador signup smoke test passed');
    console.log(`Test user: ${email}`);
    console.log(`Referral code stored: ${referralCode}`);
    console.log(`Workspace id: ${workspace.id}`);
    console.log(`Redirect: ${String(completePayload.redirect ?? '')}`);
  } finally {
    if (!keepTestData) {
      if (workspaceIds.size > 0) {
        await admin.from('workspace_members').delete().in('workspace_id', Array.from(workspaceIds));
        await admin.from('workspaces').delete().in('id', Array.from(workspaceIds));
      }
      if (userId) {
        await admin.from('user_profiles').delete().eq('user_id', userId);
        await admin.from('profiles').delete().eq('id', userId);
        await admin.auth.admin.deleteUser(userId);
      }
      if (ambassadorApplicationId) {
        await admin
          .from('ambassador_applications')
          .delete()
          .eq('id', ambassadorApplicationId);
      }
      if (maxedAmbassadorApplicationId) {
        await admin
          .from('ambassador_applications')
          .delete()
          .eq('id', maxedAmbassadorApplicationId);
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
