import { NextRequest, NextResponse } from 'next/server';
import type { Contact, DialerCall, DialerSessionLead } from '@/types/database';
import { getDialerRequestContext } from '@/lib/dialer/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type NextLeadPayload = {
  workspaceId?: string;
  skipCurrent?: boolean;
  reason?: string;
};

async function loadLeadWithContact(
  admin: ReturnType<typeof import('@/lib/supabase/server').createAdminClient>,
  lead: DialerSessionLead
) {
  const [{ data: contact, error: contactError }, { data: activeCall, error: callError }] = await Promise.all([
    admin.from('contacts').select('*').eq('id', lead.contact_id).single(),
    admin
      .from('dialer_calls')
      .select('*')
      .eq('session_lead_id', lead.id)
      .in('status', ['pending', 'initiated', 'ringing', 'in-progress', 'answered'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (contactError) throw contactError;
  if (callError) throw callError;

  return {
    lead: {
      ...(lead as DialerSessionLead),
      contact: contact as Contact,
    },
    activeCall: (activeCall ?? null) as DialerCall | null,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const body = (await request.json().catch(() => ({}))) as NextLeadPayload;
  const { sessionId } = await params;

  const context = await getDialerRequestContext(request, body.workspaceId);
  if (context instanceof NextResponse) {
    return context;
  }

  const { data: session, error: sessionError } = await context.admin
    .from('dialer_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('workspace_id', context.workspaceId)
    .eq('user_id', context.requestUser.id)
    .maybeSingle();

  if (sessionError) {
    console.error('[dialer/sessions/next] failed to load session', sessionError);
    return NextResponse.json({ error: 'Failed to load dialer session' }, { status: 500 });
  }

  if (!session) {
    return NextResponse.json({ error: 'Dialer session not found' }, { status: 404 });
  }

  const { data: currentLead, error: currentLeadError } = await context.admin
    .from('dialer_session_leads')
    .select('*')
    .eq('session_id', sessionId)
    .eq('workspace_id', context.workspaceId)
    .eq('claimed_by_user_id', context.requestUser.id)
    .in('status', ['claimed', 'calling'])
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (currentLeadError) {
    console.error('[dialer/sessions/next] failed to load current lead', currentLeadError);
    return NextResponse.json({ error: 'Failed to load current lead' }, { status: 500 });
  }

  if (currentLead && body.skipCurrent) {
    await context.admin
      .from('dialer_session_leads')
      .update({
        status: 'skipped',
        skip_reason: body.reason?.trim() || 'Skipped by user',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', currentLead.id);
  } else if (currentLead) {
    return NextResponse.json(await loadLeadWithContact(context.admin, currentLead as DialerSessionLead));
  }

  const { data: claimedLead, error: claimError } = await context.admin.rpc('claim_next_dialer_session_lead', {
    p_session_id: sessionId,
    p_workspace_id: context.workspaceId,
    p_user_id: context.requestUser.id,
  });

  if (claimError) {
    console.error('[dialer/sessions/next] failed to claim next lead', claimError);
    return NextResponse.json({ error: 'Failed to advance to the next lead' }, { status: 500 });
  }

  if (!claimedLead) {
    const now = new Date().toISOString();
    await context.admin
      .from('dialer_sessions')
      .update({ status: 'completed', ended_at: now, updated_at: now })
      .eq('id', sessionId);
    return NextResponse.json({ lead: null, activeCall: null });
  }

  return NextResponse.json(await loadLeadWithContact(context.admin, claimedLead as DialerSessionLead));
}
