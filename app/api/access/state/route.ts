import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveDashboardAccessLevel } from '@/app/api/_utils/workspace';
import type { MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { getApprovedAmbassadorByEmail } from '@/app/lib/billing/ambassador-access';

/**
 * GET /api/access/state
 * Returns workspace role, name, and whether user has dashboard access (for subscribe page and guards).
 */
export async function GET(request: NextRequest) {
  try {
    const requestUser = await resolveUserFromRequest(request);
    if (!requestUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();
    const normalizedEmail = requestUser.email?.trim().toLowerCase() ?? null;
    const approvedAmbassador = await getApprovedAmbassadorByEmail(admin, normalizedEmail);
    const isAmbassador = !!approvedAmbassador;
    const salespersonLookup = normalizedEmail
      ? await admin
          .from('salespeople')
          .select('id, full_name, email, status')
          .eq('email', normalizedEmail)
          .eq('status', 'active')
          .maybeSingle()
      : { data: null, error: null };
    const isSalesperson = !!salespersonLookup.data && !salespersonLookup.error;
    const requestedWorkspaceId = request.nextUrl.searchParams.get('workspaceId')?.trim() || null;
    const { data: membershipRows } = await admin
      .from('workspace_members')
      .select('workspace_id, role, created_at')
      .eq('user_id', requestUser.id)
      .order('created_at', { ascending: true });
    const workspaceIds = Array.from(
      new Set((membershipRows ?? []).map((row) => row.workspace_id).filter(Boolean))
    );
    const { data: workspaceRows } = workspaceIds.length
      ? await admin
          .from('workspaces')
          .select('id, name, industry')
          .in('id', workspaceIds)
      : { data: [] };
    const workspaceOptions = (workspaceRows ?? []).map((workspace) => {
      const membership = (membershipRows ?? []).find((row) => row.workspace_id === workspace.id);
      return {
        id: workspace.id,
        name: workspace.name,
        industry: workspace.industry ?? null,
        role: membership?.role ?? null,
      };
    });
    const access = await resolveDashboardAccessLevel(
      admin as unknown as MinimalSupabaseClient,
      requestUser.id,
      requestedWorkspaceId
    );
    if (!access.workspaceId) {
      return NextResponse.json({
        userId: requestUser.id,
        role: access.role,
        workspaceId: null,
        workspace_id: null,
        workspaceName: null,
        hasAccess: access.isFounder || isAmbassador,
        reason: 'no_workspace',
        isFounder: access.isFounder,
        isAmbassador,
        ambassadorApplicationId: approvedAmbassador?.id ?? null,
        plan: isAmbassador ? 'ambassador' : 'free',
        planBadgeLabel: isAmbassador ? 'AMBASSADOR' : null,
        isSalesperson,
        salesperson: salespersonLookup.data ?? null,
        accessLevel: isSalesperson ? 'salesperson' : access.level,
        memberCount: access.memberCount,
        workspaces: workspaceOptions,
      });
    }

    const { data: workspace } = await admin
      .from('workspaces')
      .select('id, name, industry, subscription_status, trial_ends_at, max_seats')
      .eq('id', access.workspaceId)
      .single();

    if (!workspace) {
      return NextResponse.json({
        userId: requestUser.id,
        role: access.role,
        workspaceId: access.workspaceId,
        workspace_id: access.workspaceId,
        workspaceName: null,
        hasAccess: access.isFounder || isAmbassador,
        reason: 'no_workspace',
        isFounder: access.isFounder,
        isAmbassador,
        ambassadorApplicationId: approvedAmbassador?.id ?? null,
        plan: isAmbassador ? 'ambassador' : 'free',
        planBadgeLabel: isAmbassador ? 'AMBASSADOR' : null,
        accessLevel: access.level,
        memberCount: access.memberCount,
        workspaces: workspaceOptions,
      });
    }

    const status = workspace.subscription_status ?? 'inactive';
    const trialEnd = workspace.trial_ends_at
      ? new Date(workspace.trial_ends_at)
      : null;
    const subscriptionAccess =
      status === 'active' ||
      (status === 'trialing' && (!trialEnd || trialEnd > new Date()));
    const hasAccess = subscriptionAccess || access.isFounder || isAmbassador;
    const now = Date.now();
    const trialDaysRemaining =
      status === 'trialing' && trialEnd && trialEnd.getTime() > now
        ? Math.max(0, Math.ceil((trialEnd.getTime() - now) / (24 * 60 * 60 * 1000)))
        : null;
    const planBadgeLabel =
      isAmbassador
        ? 'AMBASSADOR'
        : status === 'active'
        ? 'PRO'
        : trialDaysRemaining != null
          ? `${trialDaysRemaining} day trial`
          : null;
    const plan = isAmbassador
      ? 'ambassador'
      : status === 'active' || subscriptionAccess
        ? 'pro'
        : 'free';

    return NextResponse.json({
      userId: requestUser.id,
      role: access.role,
      workspaceId: workspace.id,
      workspace_id: workspace.id,
      workspaceName: workspace.name,
      industry: workspace.industry ?? null,
      maxSeats: workspace.max_seats ?? 1,
      hasAccess,
      plan,
      subscriptionStatus: status,
      trialEndsAt: workspace.trial_ends_at ?? null,
      trialDaysRemaining,
      planBadgeLabel,
      isFounder: access.isFounder,
      isAmbassador,
      ambassadorApplicationId: approvedAmbassador?.id ?? null,
      isSalesperson,
      salesperson: salespersonLookup.data ?? null,
      accessLevel: isSalesperson && !access.isFounder ? 'salesperson' : access.level,
      memberCount: access.memberCount,
      workspaces: workspaceOptions,
      reason:
        access.level === 'member' && !hasAccess
          ? 'member-inactive'
          : undefined,
    });
  } catch (e) {
    console.error('Access state error:', e);
    return NextResponse.json(
      { error: 'Failed to get access state' },
      { status: 500 }
    );
  }
}
