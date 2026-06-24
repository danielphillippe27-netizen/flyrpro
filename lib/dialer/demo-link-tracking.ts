import { randomBytes } from 'crypto';
import { NextRequest } from 'next/server';
import { getTrackingMetadata } from '@/app/lib/ambassador/tracking';
import { sanitizeTrackingParam } from '@/app/lib/ambassador/portal';
import { createAdminClient } from '@/lib/supabase/server';
import type { DiallerLead } from '@/types/database';

type AdminClient = ReturnType<typeof createAdminClient>;

type SalespersonForDemoLink = {
  id?: string | null;
  referral_code?: string | null;
};

type DemoLinkRow = {
  id: string;
  token: string;
  salesperson_id: string;
  workspace_id: string | null;
  dialler_lead_id: string | null;
  contact_id: string | null;
  referral_code: string;
  recipient_email: string | null;
  recipient_name: string | null;
  source: string | null;
  campaign: string | null;
  destination_path: string;
  opened_at: string | null;
  open_count: number | null;
  follow_up_created_at: string | null;
  converted_at: string | null;
};

type ContactLike = {
  id?: unknown;
};

const FOLLOW_UP_DELAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DEMO_DESTINATION_PATH = '/demo-1';

function cleanText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function normalizeEmail(value: string | null | undefined): string | null {
  return cleanText(value)?.toLowerCase() ?? null;
}

function normalizeDestinationPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return DEFAULT_DEMO_DESTINATION_PATH;
  return trimmed;
}

function createDemoLinkToken(): string {
  return randomBytes(18).toString('base64url');
}

function getContactId(contact: ContactLike | null | undefined): string | null {
  return typeof contact?.id === 'string' ? contact.id : null;
}

export async function createTrackedDemoLink(params: {
  admin: AdminClient;
  origin: string;
  salesperson: SalespersonForDemoLink | null;
  workspaceId: string;
  lead: DiallerLead;
  contact?: ContactLike | null;
  referralCode: string | null;
  source?: string | null;
  campaign?: string | null;
  destinationPath?: string;
}): Promise<{ url: string; token: string; linkId: string } | null> {
  if (!params.salesperson?.id || !params.referralCode) return null;

  const destinationPath = normalizeDestinationPath(params.destinationPath ?? DEFAULT_DEMO_DESTINATION_PATH);
  const source = sanitizeTrackingParam(params.source ?? 'salesperson');
  const campaign = sanitizeTrackingParam(params.campaign ?? 'power-dialer-demo');

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = createDemoLinkToken();
    const { data, error } = await params.admin
      .from('salesperson_demo_links')
      .insert({
        token,
        salesperson_id: params.salesperson.id,
        workspace_id: params.workspaceId,
        dialler_lead_id: params.lead.id,
        contact_id: getContactId(params.contact),
        referral_code: params.referralCode.trim().toUpperCase(),
        recipient_email: normalizeEmail(params.lead.email),
        recipient_name: cleanText(params.lead.name),
        source,
        campaign,
        destination_path: destinationPath,
      })
      .select('id, token')
      .single();

    if (!error && data?.id && data.token) {
      const url = new URL(`/d/${encodeURIComponent(data.token)}`, params.origin);
      return { url: url.toString(), token: data.token, linkId: data.id };
    }

    if (error && !error.message?.toLowerCase().includes('duplicate')) {
      console.warn('[demo-link-tracking] failed to create tracked demo link', error);
      return null;
    }
  }

  return null;
}

export async function resolveDemoLinkByToken(
  admin: AdminClient,
  token: string,
): Promise<DemoLinkRow | null> {
  const { data, error } = await admin
    .from('salesperson_demo_links')
    .select(
      'id, token, salesperson_id, workspace_id, dialler_lead_id, contact_id, referral_code, recipient_email, recipient_name, source, campaign, destination_path, opened_at, open_count, follow_up_created_at, converted_at',
    )
    .eq('token', token)
    .maybeSingle();

  if (error) {
    console.warn('[demo-link-tracking] failed to resolve demo link', error);
    return null;
  }

  return (data as DemoLinkRow | null) ?? null;
}

export async function recordDemoLinkOpen(params: {
  admin: AdminClient;
  request: NextRequest;
  link: DemoLinkRow;
}): Promise<void> {
  const now = new Date();
  const openedAt = params.link.opened_at ?? now.toISOString();
  const followUpDueAt = new Date(now.getTime() + FOLLOW_UP_DELAY_MS).toISOString();
  const metadata = getTrackingMetadata(params.request);
  const openCount = Math.max(0, Number(params.link.open_count ?? 0)) + 1;
  const shouldCreateFollowUp =
    !params.link.converted_at &&
    !params.link.follow_up_created_at &&
    Boolean(params.link.dialler_lead_id);

  const { error: updateError } = await params.admin
    .from('salesperson_demo_links')
    .update({
      opened_at: openedAt,
      last_opened_at: now.toISOString(),
      open_count: openCount,
      ...(shouldCreateFollowUp
        ? {
            follow_up_due_at: followUpDueAt,
            follow_up_created_at: now.toISOString(),
          }
        : {}),
    })
    .eq('id', params.link.id);

  if (updateError) {
    console.warn('[demo-link-tracking] failed to update demo link open', updateError);
  }

  await params.admin
    .from('salesperson_click_events')
    .insert({
      salesperson_id: params.link.salesperson_id,
      referral_code: params.link.referral_code,
      source: metadata.source ?? params.link.source,
      campaign: metadata.campaign ?? params.link.campaign,
      demo_link_id: params.link.id,
      ip_hash: metadata.ipHash,
      user_agent: metadata.userAgent,
      referer: metadata.referer,
    })
    .then(({ error }) => {
      if (error) {
        console.warn('[demo-link-tracking] failed to record click event', error);
      }
    });

  if (!shouldCreateFollowUp || !params.link.dialler_lead_id) return;

  const { error: leadError } = await params.admin
    .from('dialler_leads')
    .update({
      follow_up_name: 'Opened demo, no signup',
      follow_up_at: followUpDueAt,
      demo_link_follow_up_id: params.link.id,
      updated_at: now.toISOString(),
    })
    .eq('id', params.link.dialler_lead_id)
    .is('follow_up_at', null);

  if (leadError) {
    console.warn('[demo-link-tracking] failed to create demo open follow-up', leadError);
  }

  if (!params.link.contact_id) return;

  const { error: contactError } = await params.admin
    .from('contacts')
    .update({
      follow_up_at: followUpDueAt,
      reminder_date: followUpDueAt,
      demo_link_follow_up_id: params.link.id,
      status: 'follow_up',
      updated_at: now.toISOString(),
    })
    .eq('id', params.link.contact_id)
    .is('follow_up_at', null);

  if (contactError) {
    console.warn('[demo-link-tracking] failed to create contact follow-up', contactError);
  }

  await params.admin
    .from('contact_activities')
    .insert({
      contact_id: params.link.contact_id,
      type: 'note',
      note: `Opened tracked demo link. Auto follow-up scheduled for ${new Date(followUpDueAt).toLocaleString()}.`,
      timestamp: now.toISOString(),
    })
    .then(({ error }) => {
      if (error) {
        console.warn('[demo-link-tracking] failed to log demo open activity', error);
      }
    });
}

export function buildDemoLinkDestination(link: DemoLinkRow, request: NextRequest): URL {
  const destination = new URL(normalizeDestinationPath(link.destination_path), request.nextUrl.origin);
  destination.searchParams.set('referralCode', link.referral_code);
  if (link.source) destination.searchParams.set('source', link.source);
  if (link.campaign) destination.searchParams.set('campaign', link.campaign);
  destination.searchParams.set('demoLink', link.token);
  return destination;
}

export async function resolveDemoLinkForEvent(params: {
  admin: AdminClient;
  token?: string | null;
  referralCode: string;
}): Promise<{ id: string; referralCode: string } | null> {
  const token = cleanText(params.token ?? undefined);
  if (!token) return null;

  const link = await resolveDemoLinkByToken(params.admin, token);
  if (!link) return null;
  if (link.referral_code.trim().toUpperCase() !== params.referralCode.trim().toUpperCase()) {
    return null;
  }

  return { id: link.id, referralCode: link.referral_code };
}

export async function markConvertedDemoLinks(params: {
  admin: AdminClient;
  referralCode: string | null;
  recipientEmail: string | null;
  convertedUserId: string;
  convertedWorkspaceId: string;
}): Promise<void> {
  const referralCode = cleanText(params.referralCode ?? undefined)?.toUpperCase() ?? null;
  const recipientEmail = normalizeEmail(params.recipientEmail ?? undefined);
  if (!referralCode || !recipientEmail) return;

  const { data, error } = await params.admin
    .from('salesperson_demo_links')
    .select('id, dialler_lead_id, contact_id')
    .eq('referral_code', referralCode)
    .eq('recipient_email', recipientEmail)
    .is('converted_at', null)
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.warn('[demo-link-tracking] failed to load links for conversion', error);
    return;
  }

  const links = ((data ?? []) as Array<{
    id: string;
    dialler_lead_id: string | null;
    contact_id: string | null;
  }>).filter((link) => link.id);
  if (!links.length) return;

  const linkIds = links.map((link) => link.id);
  const now = new Date().toISOString();
  const { error: updateError } = await params.admin
    .from('salesperson_demo_links')
    .update({
      converted_at: now,
      converted_user_id: params.convertedUserId,
      converted_workspace_id: params.convertedWorkspaceId,
    })
    .in('id', linkIds);

  if (updateError) {
    console.warn('[demo-link-tracking] failed to mark links converted', updateError);
  }

  const leadIds = links
    .map((link) => link.dialler_lead_id)
    .filter((leadId): leadId is string => Boolean(leadId));
  if (leadIds.length) {
    const { error: clearError } = await params.admin
      .from('dialler_leads')
      .update({
        follow_up_name: null,
        follow_up_at: null,
        demo_link_follow_up_id: null,
        updated_at: now,
      })
      .in('id', leadIds)
      .in('demo_link_follow_up_id', linkIds);

    if (clearError) {
      console.warn('[demo-link-tracking] failed to clear converted demo follow-up', clearError);
    }
  }

  const contactIds = links
    .map((link) => link.contact_id)
    .filter((contactId): contactId is string => Boolean(contactId));
  if (!contactIds.length) return;

  const { error: clearContactError } = await params.admin
    .from('contacts')
    .update({
      follow_up_at: null,
      reminder_date: null,
      demo_link_follow_up_id: null,
      updated_at: now,
    })
    .in('id', contactIds)
    .in('demo_link_follow_up_id', linkIds);

  if (clearContactError) {
    console.warn('[demo-link-tracking] failed to clear converted contact follow-up', clearContactError);
  }
}
