import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceMembershipForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';
import {
  getWorkspaceStormMapsAddon,
  isStormMapsBetaAvailable,
  STORM_MAPS_ADDON_KEY,
} from '@/lib/storm-maps/addon';
import { validateTomorrowFullSuiteAccess } from '@/lib/storm-maps/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function resolveContext(request: NextRequest, workspaceId: string | null | undefined) {
  const user = await resolveUserFromRequest(request);
  if (!user) return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const admin = createAdminClient();
  const membership = await resolveWorkspaceMembershipForUser(
    admin as unknown as MinimalSupabaseClient,
    user.id,
    workspaceId,
  );
  if (!membership.workspaceId) {
    return {
      response: NextResponse.json(
        { error: membership.error || 'Workspace not found' },
        { status: membership.status || 403 },
      ),
    };
  }
  return { admin, membership };
}

function responsePayload(
  addon: Awaited<ReturnType<typeof getWorkspaceStormMapsAddon>>,
  role: 'owner' | 'admin' | 'member' | null,
) {
  const betaAvailable = isStormMapsBetaAvailable();
  return {
    addon: {
      key: STORM_MAPS_ADDON_KEY,
      status: betaAvailable ? addon?.status || 'inactive' : 'inactive',
      isActive: betaAvailable && addon?.status === 'active',
      amountCents: 0,
      priceLabel: '$0 during Beta',
      beta: true,
    },
    canManage: role === 'owner' || role === 'admin',
    betaAvailable,
  };
}

export async function GET(request: NextRequest) {
  const context = await resolveContext(request, request.nextUrl.searchParams.get('workspaceId'));
  if ('response' in context) return context.response;
  const addon = await getWorkspaceStormMapsAddon(context.admin, context.membership.workspaceId!);
  return NextResponse.json(responsePayload(addon, context.membership.role));
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { workspaceId?: string; enabled?: boolean } | null;
  if (!body?.workspaceId || typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'workspaceId and enabled are required' }, { status: 400 });
  }
  const context = await resolveContext(request, body.workspaceId);
  if ('response' in context) return context.response;
  if (context.membership.role !== 'owner' && context.membership.role !== 'admin') {
    return NextResponse.json({ error: 'Only workspace owners and admins can manage add-ons' }, { status: 403 });
  }
  if (body.enabled && !isStormMapsBetaAvailable()) {
    return NextResponse.json({ error: 'Storm Maps Beta is temporarily unavailable' }, { status: 503 });
  }
  if (body.enabled) {
    const validation = await validateTomorrowFullSuiteAccess();
    if (!validation.ok) {
      return NextResponse.json(
        { error: 'Tomorrow.io production access must include all promised map fields, aggregative tiles, lightning, and premium hail layers before activation.' },
        { status: 503 },
      );
    }
  }

  const now = new Date().toISOString();
  const { error } = await context.admin.from('workspace_billing_addons').upsert(
    {
      workspace_id: context.membership.workspaceId,
      addon_key: STORM_MAPS_ADDON_KEY,
      status: body.enabled ? 'active' : 'inactive',
      stripe_subscription_id: null,
      stripe_subscription_item_id: null,
      stripe_price_id: null,
      quantity: 1,
      amount_cents: 0,
      currency: 'USD',
      activated_at: body.enabled ? now : null,
      canceled_at: body.enabled ? null : now,
      metadata: { beta: true, pricing: 'free_beta', managedFrom: 'settings' },
      updated_at: now,
    },
    { onConflict: 'workspace_id,addon_key' },
  );
  if (error) return NextResponse.json({ error: 'Could not update Storm Maps add-on' }, { status: 500 });
  const addon = await getWorkspaceStormMapsAddon(context.admin, context.membership.workspaceId!);
  return NextResponse.json(responsePayload(addon, context.membership.role));
}
