import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePhoneNumber } from '@/lib/dialer/phone';
import {
  ACTIVE_PIPELINE_STAGES,
  estimatedMonthlyValueForSeats,
} from '@/lib/sales-pipeline/constants';
import type {
  SalesLeadMatchConfidence,
  SalesLeadMatchMethod,
  SalesPipelineStage,
  SalesLead,
} from '@/types/database';

type SupabaseAdmin = Pick<SupabaseClient, 'from'>;

type DemoLinkLike = {
  id: string;
  salesperson_id: string;
  workspace_id: string | null;
  dialler_lead_id: string | null;
  contact_id: string | null;
  referral_code: string;
  recipient_email?: string | null;
};

type SalespersonRow = {
  id: string;
  user_id: string | null;
  workspace_id: string | null;
  referral_code: string | null;
};

const PIPELINE_SELECT = `
  id,
  workspace_id,
  contact_id,
  dialler_lead_id,
  assigned_user_id,
  assigned_salesperson_id,
  name,
  email,
  email_normalized,
  phone,
  phone_e164,
  pipeline_stage,
  pipeline_owner_id,
  pipeline_priority,
  assigned_sales_rep_id,
  seat_count,
  estimated_monthly_value_cents,
  next_task_title,
  next_task_type,
  next_follow_up_at,
  last_touch_at,
  last_touch_summary,
  signed_up_user_id,
  signed_up_workspace_id,
  match_confidence,
  usage_summary,
  metadata,
  created_at,
  updated_at
`;

function cleanText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function normalizeEmail(value: string | null | undefined): string | null {
  return cleanText(value).toLowerCase() || null;
}

function nextStageOnDemoOpen(current?: string | null): SalesPipelineStage {
  if (!current || current === 'new_lead' || current === 'attempting_contact' || current === 'connected') {
    return 'demo_sent';
  }
  return current as SalesPipelineStage;
}

function isActiveStage(value?: string | null): boolean {
  return ACTIVE_PIPELINE_STAGES.has((value ?? 'new_lead') as SalesPipelineStage);
}

async function findLeadForDemoLink(
  admin: SupabaseAdmin,
  link: DemoLinkLike
): Promise<SalesLead | null> {
  if (!link.workspace_id) return null;

  const clauses: string[] = [];
  if (link.contact_id) clauses.push(`contact_id.eq.${link.contact_id}`);
  if (link.dialler_lead_id) clauses.push(`dialler_lead_id.eq.${link.dialler_lead_id}`);
  if (!clauses.length) return null;

  const { data, error } = await admin
    .from('sales_leads')
    .select(PIPELINE_SELECT)
    .eq('workspace_id', link.workspace_id)
    .or(clauses.join(','))
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('[sales-pipeline] demo link lead lookup failed', error);
    return null;
  }

  return (data as SalesLead | null) ?? null;
}

async function insertPipelineActivity(params: {
  admin: SupabaseAdmin;
  lead: Pick<SalesLead, 'id' | 'workspace_id' | 'assigned_salesperson_id' | 'assigned_sales_rep_id'>;
  actorUserId?: string | null;
  type: string;
  title: string;
  body?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await params.admin
    .from('sales_activities')
    .insert({
      sales_lead_id: params.lead.id,
      workspace_id: params.lead.workspace_id,
      actor_user_id: params.actorUserId ?? null,
      activity_type: params.type,
      note: params.body ? `${params.title}\n\n${params.body}` : params.title,
      occurred_at: new Date().toISOString(),
      metadata: {
        ...(params.metadata ?? {}),
        title: params.title,
        body: params.body ?? null,
        legacySalespersonId: params.lead.assigned_salesperson_id ?? null,
        salesRepId: params.lead.assigned_sales_rep_id ?? null,
      },
    });

  if (error) {
    console.warn('[sales-pipeline] activity insert failed', error);
  }
}

async function insertAppMatch(params: {
  admin: SupabaseAdmin;
  lead: Pick<SalesLead, 'id' | 'workspace_id' | 'assigned_salesperson_id' | 'assigned_sales_rep_id'>;
  method: SalesLeadMatchMethod;
  confidence: SalesLeadMatchConfidence;
  matchedUserId?: string | null;
  matchedWorkspaceId?: string | null;
  demoLinkId?: string | null;
  matchedEmail?: string | null;
  matchedPhoneE164?: string | null;
  autoApplied: boolean;
  evidence?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await params.admin
    .from('sales_activities')
    .insert({
      sales_lead_id: params.lead.id,
      workspace_id: params.lead.workspace_id,
      activity_type: params.confidence === 'ambiguous' ? 'match_review' : 'signup',
      note: params.confidence === 'ambiguous'
        ? 'Ambiguous app signup match needs review.'
        : 'App signup match recorded.',
      occurred_at: new Date().toISOString(),
      metadata: {
        legacyAppMatch: true,
        legacySalespersonId: params.lead.assigned_salesperson_id ?? null,
        salesRepId: params.lead.assigned_sales_rep_id ?? null,
        matchedUserId: params.matchedUserId ?? null,
        matchedWorkspaceId: params.matchedWorkspaceId ?? null,
        demoLinkId: params.demoLinkId ?? null,
        matchMethod: params.method,
        matchConfidence: params.confidence,
        matchedEmail: params.matchedEmail ?? null,
        matchedPhoneE164: params.matchedPhoneE164 ?? null,
        autoApplied: params.autoApplied,
        evidence: params.evidence ?? {},
      },
    });

  if (error) {
    console.warn('[sales-pipeline] app match insert failed', error);
  }
}

async function loadSalespersonByReferralCode(
  admin: SupabaseAdmin,
  referralCode: string | null
): Promise<SalespersonRow | null> {
  const code = cleanText(referralCode).toUpperCase();
  if (!code) return null;

  const { data, error } = await admin
    .from('salespeople')
    .select('id, user_id, workspace_id, referral_code')
    .ilike('referral_code', code)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('[sales-pipeline] salesperson referral lookup failed', error);
    return null;
  }

  return (data as SalespersonRow | null) ?? null;
}

export async function recordDemoOpenInPipeline(params: {
  admin: SupabaseAdmin;
  link: DemoLinkLike;
  followUpDueAt: string;
  openedAt: string;
}): Promise<void> {
  const lead = await findLeadForDemoLink(params.admin, params.link);
  if (!lead?.id) return;

  const title = 'Follow up - opened demo, no signup';
  const nextTaskShouldChange = isActiveStage(lead.pipeline_stage);

  const { error } = await params.admin
    .from('sales_leads')
    .update({
      pipeline_stage: nextStageOnDemoOpen(lead.pipeline_stage),
      last_touch_at: params.openedAt,
      last_touch_summary: 'Opened tracked demo link',
      ...(nextTaskShouldChange
        ? {
            next_task_title: title,
            next_task_type: 'demo_follow_up',
            next_follow_up_at: params.followUpDueAt,
          }
        : {}),
    })
    .eq('id', lead.id);

  if (error) {
    console.warn('[sales-pipeline] failed to update demo-open pipeline state', error);
  }

  await insertPipelineActivity({
    admin: params.admin,
    lead,
    type: 'demo_opened',
    title: 'Demo opened',
    body: `Tracked demo link opened. Follow-up due ${new Date(params.followUpDueAt).toLocaleString()}.`,
    metadata: {
      demoLinkId: params.link.id,
      followUpDueAt: params.followUpDueAt,
    },
  });
}

async function applyStrongSignupMatch(params: {
  admin: SupabaseAdmin;
  lead: SalesLead;
  method: SalesLeadMatchMethod;
  convertedUserId: string;
  convertedWorkspaceId: string;
  matchedEmail?: string | null;
  matchedPhoneE164?: string | null;
  demoLinkId?: string | null;
  evidence?: Record<string, unknown>;
}): Promise<void> {
  const now = new Date().toISOString();
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const seats = Math.max(1, Number(params.lead.seat_count ?? 1));

  const { error } = await params.admin
    .from('sales_leads')
    .update({
      pipeline_stage: 'trial_active',
      pipeline_owner_id: params.lead.pipeline_owner_id ?? params.lead.assigned_user_id,
      next_task_title: 'Check in tomorrow - help them create first campaign',
      next_task_type: 'trial_check_in',
      next_follow_up_at: tomorrow,
      last_touch_at: now,
      last_touch_summary: 'Signed up for trial',
      trial_status: 'active',
      trial_started_at: params.lead.trial_started_at ?? now,
      signed_up_user_id: params.convertedUserId,
      signed_up_workspace_id: params.convertedWorkspaceId,
      match_confidence: 'strong',
      estimated_monthly_value_cents: estimatedMonthlyValueForSeats(seats),
    })
    .eq('id', params.lead.id);

  if (error) {
    console.warn('[sales-pipeline] failed to apply strong signup match', error);
    return;
  }

  await insertAppMatch({
    admin: params.admin,
    lead: params.lead,
    method: params.method,
    confidence: 'strong',
    matchedUserId: params.convertedUserId,
    matchedWorkspaceId: params.convertedWorkspaceId,
    demoLinkId: params.demoLinkId ?? null,
    matchedEmail: params.matchedEmail ?? null,
    matchedPhoneE164: params.matchedPhoneE164 ?? null,
    autoApplied: true,
    evidence: params.evidence,
  });

  await insertPipelineActivity({
    admin: params.admin,
    lead: params.lead,
    type: 'signup',
    title: 'Trial signup matched',
    body: 'Strong match applied automatically.',
    metadata: {
      method: params.method,
      confidence: 'strong',
      signedUpUserId: params.convertedUserId,
      signedUpWorkspaceId: params.convertedWorkspaceId,
      demoLinkId: params.demoLinkId ?? null,
    },
  });
}

export async function applyDemoLinkSignupMatches(params: {
  admin: SupabaseAdmin;
  links: Array<DemoLinkLike>;
  convertedUserId: string;
  convertedWorkspaceId: string;
  recipientEmail: string | null;
}): Promise<void> {
  for (const link of params.links) {
    const lead = await findLeadForDemoLink(params.admin, link);
    if (!lead?.id) continue;
    await applyStrongSignupMatch({
      admin: params.admin,
      lead,
      method: 'invite_link',
      convertedUserId: params.convertedUserId,
      convertedWorkspaceId: params.convertedWorkspaceId,
      matchedEmail: params.recipientEmail,
      demoLinkId: link.id,
      evidence: { referralCode: link.referral_code },
    });
  }
}

async function findEmailMatchCandidates(params: {
  admin: SupabaseAdmin;
  salesperson: SalespersonRow;
  email: string;
}): Promise<SalesLead[]> {
  if (!params.salesperson.workspace_id) return [];

  let query = params.admin
    .from('sales_leads')
    .select(PIPELINE_SELECT)
    .eq('workspace_id', params.salesperson.workspace_id)
    .eq('email_normalized', params.email)
    .order('updated_at', { ascending: false })
    .limit(5);

  if (params.salesperson.id) {
    query = query.or(`assigned_salesperson_id.eq.${params.salesperson.id},pipeline_owner_id.eq.${params.salesperson.user_id}`);
  }

  const { data, error } = await query;
  if (error) {
    console.warn('[sales-pipeline] email match lookup failed', error);
    return [];
  }

  return (data ?? []) as SalesLead[];
}

export async function applyEmailSignupMatch(params: {
  admin: SupabaseAdmin;
  referralCode: string | null;
  recipientEmail: string | null;
  convertedUserId: string;
  convertedWorkspaceId: string;
}): Promise<void> {
  const email = normalizeEmail(params.recipientEmail);
  if (!email) return;

  const salesperson = await loadSalespersonByReferralCode(params.admin, params.referralCode);
  if (!salesperson?.id) return;

  const candidates = await findEmailMatchCandidates({
    admin: params.admin,
    salesperson,
    email,
  });

  if (candidates.length === 0) return;

  if (candidates.length > 1) {
    for (const lead of candidates) {
      await insertAppMatch({
        admin: params.admin,
        lead,
        method: 'email',
        confidence: 'ambiguous',
        matchedUserId: params.convertedUserId,
        matchedWorkspaceId: params.convertedWorkspaceId,
        matchedEmail: email,
        autoApplied: false,
        evidence: {
          candidateCount: candidates.length,
          referralCode: params.referralCode,
        },
      });
      await insertPipelineActivity({
        admin: params.admin,
        lead,
        type: 'match_review',
        title: 'Ambiguous signup match',
        body: `Multiple leads matched ${email}. Manual review needed.`,
        metadata: { candidateCount: candidates.length },
      });
    }
    return;
  }

  const [lead] = candidates;
  if (lead.signed_up_user_id || lead.match_confidence === 'strong') return;

  await applyStrongSignupMatch({
    admin: params.admin,
    lead,
    method: 'email',
    convertedUserId: params.convertedUserId,
    convertedWorkspaceId: params.convertedWorkspaceId,
    matchedEmail: email,
    evidence: { referralCode: params.referralCode },
  });
}

export async function recordPhoneSignupMatchForReview(params: {
  admin: SupabaseAdmin;
  salesperson: SalespersonRow;
  phone: string | null;
  convertedUserId: string;
  convertedWorkspaceId: string;
}): Promise<void> {
  const phoneE164 = normalizePhoneNumber(params.phone).e164;
  if (!phoneE164 || !params.salesperson.workspace_id) return;

  const { data, error } = await params.admin
    .from('sales_leads')
    .select(PIPELINE_SELECT)
    .eq('workspace_id', params.salesperson.workspace_id)
    .eq('phone_e164', phoneE164)
    .limit(5);

  if (error) {
    console.warn('[sales-pipeline] phone match lookup failed', error);
    return;
  }

  const leads = (data ?? []) as SalesLead[];
  const confidence: SalesLeadMatchConfidence = leads.length === 1 ? 'medium' : 'ambiguous';
  for (const lead of leads) {
    await insertAppMatch({
      admin: params.admin,
      lead,
      method: 'phone',
      confidence,
      matchedUserId: params.convertedUserId,
      matchedWorkspaceId: params.convertedWorkspaceId,
      matchedPhoneE164: phoneE164,
      autoApplied: false,
      evidence: { candidateCount: leads.length },
    });
  }
}
