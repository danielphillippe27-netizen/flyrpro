import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/server';

const INDUSTRIES = [
  'Real Estate',
  'Logistics',
  'Sales',
  'Pest Control',
  'HVAC',
  'Insurance',
  'Solar',
  'Other',
] as const;

export async function POST(request: NextRequest) {
  try {
    const supabase = await getSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      firstName,
      lastName,
      workspaceName,
      industry,
      referralCode,
      useCase,
      maxSeats,
      brokerage,
      brokerageId,
    } = body as {
      firstName?: string;
      lastName?: string;
      workspaceName?: string;
      industry?: string;
      referralCode?: string | null;
      useCase?: 'solo' | 'team';
      maxSeats?: number;
      brokerage?: string;
      brokerageId?: string;
    };

    const admin = createAdminClient();

    if (firstName !== undefined || lastName !== undefined) {
      const { error: profileError } = await supabase
        .from('user_profiles')
        .update({
          first_name: typeof firstName === 'string' ? firstName.trim() || null : undefined,
          last_name: typeof lastName === 'string' ? lastName.trim() || null : undefined,
        })
        .eq('user_id', user.id);

      if (profileError) {
        return NextResponse.json(
          { error: 'Failed to update profile' },
          { status: 500 }
        );
      }
    }

    // Use admin client so we always find an existing owner workspace (avoids RLS/race creating duplicates)
    let workspaceId = await (async () => {
      const { data: memberships } = await admin
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', user.id)
        .eq('role', 'owner')
        .order('created_at', { ascending: true })
        .limit(1);

      return memberships?.[0]?.workspace_id ?? null;
    })();

    // If user has no owner workspace (e.g. account created before workspace trigger or backfill missed them),
    // create one so onboarding can complete.
    if (!workspaceId) {
      const initialName =
        typeof workspaceName === 'string' && workspaceName.trim()
          ? workspaceName.trim()
          : 'My Workspace';
      const { data: newWorkspace, error: createErr } = await admin
        .from('workspaces')
        .insert({
          name: initialName,
          owner_id: user.id,
        })
        .select('id')
        .single();

      if (createErr || !newWorkspace?.id) {
        console.error('Onboarding: failed to create workspace', createErr);
        return NextResponse.json(
          { error: 'Failed to create workspace. Please try again.' },
          { status: 500 }
        );
      }

      const { error: memberErr } = await admin
        .from('workspace_members')
        .insert({
          workspace_id: newWorkspace.id,
          user_id: user.id,
          role: 'owner',
        });

      if (memberErr) {
        console.error('Onboarding: failed to add owner membership', memberErr);
        return NextResponse.json(
          { error: 'Failed to set up workspace. Please try again.' },
          { status: 500 }
        );
      }

      workspaceId = newWorkspace.id;
    }

    const trialEndsAt = new Date();
    trialEndsAt.setFullYear(trialEndsAt.getFullYear() + 1);

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      onboarding_completed_at: new Date().toISOString(),
      subscription_status: 'trialing',
      trial_ends_at: trialEndsAt.toISOString(),
    };

    if (typeof workspaceName === 'string' && workspaceName.trim()) {
      updates.name = workspaceName.trim();
    }
    if (typeof industry === 'string' && industry.trim()) {
      updates.industry = INDUSTRIES.includes(industry as (typeof INDUSTRIES)[number])
        ? industry
        : industry.trim();
    }
    if (referralCode !== undefined) {
      updates.referral_code_used =
        typeof referralCode === 'string' && referralCode.trim() ? referralCode.trim() : null;
    }
    if (maxSeats !== undefined || useCase !== undefined) {
      const requestedSeats =
        Number.isFinite(maxSeats) && typeof maxSeats === 'number'
          ? Math.trunc(maxSeats)
          : NaN;
      if (Number.isFinite(requestedSeats) && requestedSeats > 0) {
        updates.max_seats = Math.min(100, requestedSeats);
      } else if (useCase === 'team') {
        updates.max_seats = 2;
      } else if (useCase === 'solo') {
        updates.max_seats = 1;
      }
    }

    // Brokerage: persist brokerage_id when selected, else try template match or store custom brokerage_name
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (typeof brokerageId === 'string' && uuidRegex.test(brokerageId.trim())) {
      updates.brokerage_id = brokerageId.trim();
      updates.brokerage_name = null;
    } else if (typeof brokerage === 'string' && brokerage.trim()) {
      const sanitized = brokerage
        .trim()
        .replace(/\s+/g, ' ')
        .trim();
      const { data: match } = await admin
        .from('brokerages')
        .select('id')
        .ilike('name', sanitized)
        .limit(1)
        .maybeSingle();
      if (match?.id) {
        updates.brokerage_id = match.id;
        updates.brokerage_name = null;
      } else {
        updates.brokerage_id = null;
        updates.brokerage_name = sanitized;
      }
    }

    const { error: workspaceError } = await admin
      .from('workspaces')
      .update(updates)
      .eq('id', workspaceId);

    if (workspaceError) {
      return NextResponse.json(
        { error: 'Failed to update workspace' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, redirect: '/subscribe' });
  } catch (e) {
    console.error('Onboarding complete error:', e);
    return NextResponse.json(
      { error: 'Something went wrong' },
      { status: 500 }
    );
  }
}
