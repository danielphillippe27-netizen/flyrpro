import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  resolveWorkspaceMembershipForUser,
  type MinimalSupabaseClient,
} from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';
import { isDialerFounderBypassEmail } from '@/lib/dialer/feature-gate';
import { getWorkspaceDialerSettings } from '@/lib/dialer/server';
import { getSalespersonDialerSettingsForUser } from '@/lib/dialer/salesperson-settings';
import { resolveOutboundCallerId } from '@/lib/dialer/caller-id';
import { normalizePhoneMarket, normalizePhoneNumber, phoneMarketFromCountryCode, type SupportedPhoneMarket } from '@/lib/dialer/phone';
import { getDialerCallRecordingSummary } from '@/lib/dialer/recordings';
import { sendDialerSms } from '@/lib/dialer/provider';
import {
  DEMO_EMAIL_DOMAIN,
  resolveAvailableDemoEmailHandle,
  type HandleLookupClient,
} from '@/lib/dialer/demo-email-handle';
import { createTrackedDemoLink } from '@/lib/dialer/demo-link-tracking';
import type { DialerCallStatus, DiallerLead, DiallerLeadCallOutcome, DiallerLeadDisposition } from '@/types/database';
import {
  ensureSalespersonReferralCode,
  normalizeSalespersonReferralCodeInput,
} from '@/app/lib/billing/salespeople';
import { generateDemoLinkForLead } from '@/lib/demo/generateDemoLinkForLead';
import {
  attachDiallerLeadToMaster,
  ensureSalespersonLeadMaster,
  updateMasterLeadDispositionForDiallerLead,
} from '@/lib/sales-leads/master-list';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ImportLeadPayload = {
  workspaceId?: string;
  phoneMarket?: string | null;
  testLead?: boolean;
  leads?: Array<{
    name?: string | null;
    phone?: string | null;
    company?: string | null;
    email?: string | null;
  }>;
};

type DiallerLeadInsert = {
  workspace_id: string;
  user_id: string;
  name: string;
  phone: string;
  phone_e164?: string | null;
  phone_country_code?: string | null;
  phone_area_code?: string | null;
  phone_area_label?: string | null;
  company: string | null;
  email: string | null;
  disposition: null;
  lead_state?: 'queued';
  source?: string;
  notes: null;
  called_at: null;
  master_lead_id?: string | null;
};

type UpdateLeadPayload = {
  workspaceId?: string;
  id?: string;
  isStarred?: boolean;
  markCalled?: boolean;
  disposition?: DiallerLeadDisposition | null;
  notes?: string | null;
  email?: string | null;
  sendDemoEmail?: boolean;
  demoEmailSubject?: string | null;
  demoEmailBody?: string | null;
  demoLinkToken?: string | null;
  demoAudience?: DemoAudience | null;
  sendLink?: boolean;
  followUpName?: string | null;
  followUpAt?: string | null;
  createNotification?: boolean;
  saveContact?: boolean;
};

type DemoAudience = 'team' | 'solo' | 'brokerage';

type DiallerContext = {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
  requestUser: { id: string; email: string | null };
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

type SalespersonReferralRow = {
  id: string;
  full_name: string | null;
  email?: string | null;
  referral_code: string | null;
  demo_email_handle?: string | null;
  demo_email_reply_to?: string | null;
  workspace_id?: string | null;
};

const VALID_DISPOSITIONS = new Set<DiallerLeadDisposition>([
  'interested',
  'callback',
  'not_now',
  'dnc',
]);
const FALLBACK_PUBLIC_ORIGIN = 'https://wolfgrid.app';
const DIALER_DEMO_VIDEO_PATH = '/demo-1';
const LISTING_DEMO_VIDEO_PATH = '/demo-2';

type DiallerLeadCallRow = {
  id: string;
  status: DialerCallStatus | null;
  answered_at: string | null;
  ended_at: string | null;
  created_at: string;
  status_payload: Record<string, unknown> | null;
};

type MasterLeadRow = {
  id: string;
  assigned_user_id: string;
  dialler_lead_id?: string | null;
};

async function resolveDiallerContext(request: NextRequest, workspaceId?: string | null) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const membership = await resolveWorkspaceMembershipForUser(
    admin as unknown as MinimalSupabaseClient,
    requestUser.id,
    workspaceId
  );

  if (!membership.workspaceId) {
    if (workspaceId && isDialerFounderBypassEmail(requestUser.email)) {
      const { data: workspace } = await admin
        .from('workspaces')
        .select('id')
        .eq('id', workspaceId)
        .maybeSingle();

      if (workspace?.id) {
        return {
          admin,
          workspaceId: workspace.id as string,
          requestUser,
        };
      }
    }

    return NextResponse.json(
      { error: membership.error ?? 'Workspace not found' },
      { status: membership.status ?? 403 }
    );
  }

  return {
    admin,
    workspaceId: membership.workspaceId,
    requestUser,
  };
}

function cleanText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function inferDiallerListName(lead: DiallerLead): string | null {
  const notes = cleanText(lead.notes);
  const match = notes.match(/(?:^|\n)List:\s*([^\n]+)/i);
  return cleanText(match?.[1] ?? null) || null;
}

function withDiallerListMetadata(lead: DiallerLead): DiallerLead {
  const listName = cleanText(lead.list_name) || inferDiallerListName(lead);
  if (!listName) return lead;

  return {
    ...lead,
    list_id: cleanText(lead.list_id) || listName.toLowerCase(),
    list_name: listName,
  };
}

function normalizeDiallerLeadPhone(lead: DiallerLead) {
  return normalizePhoneNumber(
    cleanText(lead.phone_e164) || lead.phone,
    phoneMarketFromCountryCode(lead.phone_country_code)
  );
}

function getEnv(name: string): string | null {
  const value = process.env[name];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDemoSenderName(salesperson: SalespersonReferralRow | null, userEmail: string | null): string {
  return cleanText(salesperson?.full_name) || cleanText(userEmail).split('@')[0] || 'WolfGrid';
}

function parseUuidList(value: string | null | undefined): string[] {
  return Array.from(
    new Set(
      (value ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter((id) => UUID_PATTERN.test(id))
    )
  ).slice(0, 100);
}

function normalizePublicOrigin(value: string | null | undefined): string | null {
  const cleaned = value?.trim().replace(/\/+$/, '');
  if (!cleaned) return null;
  try {
    const parsed = new URL(cleaned.startsWith('http') ? cleaned : `https://${cleaned}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.hostname.toLowerCase() === 'wolfgrid.app') {
      parsed.hostname = 'wolfgrid.app';
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function getPublicOrigin(request: NextRequest): string {
  return (
    normalizePublicOrigin(process.env.NEXT_PUBLIC_APP_URL) ||
    normalizePublicOrigin(process.env.APP_BASE_URL) ||
    normalizePublicOrigin(process.env.VERCEL_URL) ||
    normalizePublicOrigin(request.nextUrl.origin) ||
    FALLBACK_PUBLIC_ORIGIN
  );
}

async function resolveSalespersonReferralCode(context: DiallerContext): Promise<string | null> {
  const normalizedEmail = context.requestUser.email?.trim().toLowerCase();
  const select = 'id, full_name, email, referral_code, workspace_id';
  const ensureCode = async (salesperson: SalespersonReferralRow | null | undefined) => {
    if (!salesperson?.id) return null;

    const existing = normalizeSalespersonReferralCodeInput(
      (salesperson.referral_code ?? '').trim()
    );
    if (existing) return existing;

    try {
      return await ensureSalespersonReferralCode(context.admin, {
        salespersonId: salesperson.id,
        fullName: salesperson.full_name || normalizedEmail || 'Salesperson',
        existingReferralCode: salesperson.referral_code,
      });
    } catch (error) {
      console.warn('[dialer/leads] salesperson referral code generation failed', error);
      return null;
    }
  };

  if (normalizedEmail) {
    const { data, error } = await context.admin
      .from('salespeople')
      .select(select)
      .ilike('email', normalizedEmail)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      return ensureCode(data as SalespersonReferralRow);
    }

    if (error) {
      console.warn('[dialer/leads] salesperson email lookup failed', error);
    }
  }

  const { data, error } = await context.admin
    .from('salespeople')
    .select(select)
    .eq('workspace_id', context.workspaceId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('[dialer/leads] salesperson workspace lookup failed', error);
    return null;
  }

  return ensureCode(data as SalespersonReferralRow | null);
}

async function resolveSalespersonForDemoEmail(context: DiallerContext): Promise<SalespersonReferralRow | null> {
  const normalizedEmail = context.requestUser.email?.trim().toLowerCase();
  const select = 'id, full_name, email, referral_code, demo_email_handle, demo_email_reply_to, workspace_id';

  if (normalizedEmail) {
    const { data, error } = await context.admin
      .from('salespeople')
      .select(select)
      .ilike('email', normalizedEmail)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (!error && data) return data as SalespersonReferralRow;
    if (error) console.warn('[dialer/leads] salesperson demo email lookup failed', error);
  }

  const { data, error } = await context.admin
    .from('salespeople')
    .select(select)
    .eq('workspace_id', context.workspaceId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('[dialer/leads] salesperson workspace demo email lookup failed', error);
    return null;
  }

  return data as SalespersonReferralRow | null;
}

async function resolveDiallerSmsFromNumber(
  context: DiallerContext,
  toNumber: string
): Promise<string | null> {
  const salespersonContext = await getSalespersonDialerSettingsForUser(context.admin, {
    userId: context.requestUser.id,
    email: context.requestUser.email,
    workspaceId: context.workspaceId,
  });
  const settings = await getWorkspaceDialerSettings(
    context.admin,
    context.workspaceId,
    salespersonContext.settings
  );

  if (!settings.defaultSmsFromNumber) return null;

  return resolveOutboundCallerId({
    toNumber,
    defaultFromNumber: settings.defaultSmsFromNumber,
    allowMarketOverride: !settings.salespersonSmsFromNumber,
  });
}

async function buildDialerDemoUrl(
  request: NextRequest,
  context: DiallerContext,
  options?: {
    demoPath?: string;
    campaign?: string;
  }
): Promise<{
  url: string;
  referralCode: string | null;
}> {
  const publicOrigin = getPublicOrigin(request);
  const referralCode = await resolveSalespersonReferralCode(context);
  const demoPath = options?.demoPath ?? DIALER_DEMO_VIDEO_PATH;
  const campaign = options?.campaign ?? 'power-dialer-demo';

  if (!referralCode) {
    return {
      url: new URL(demoPath, publicOrigin).toString(),
      referralCode: null,
    };
  }

  const url = new URL(`/s/${encodeURIComponent(referralCode)}`, publicOrigin);
  url.searchParams.set('source', 'salesperson');
  url.searchParams.set('campaign', campaign);
  url.searchParams.set('redirect', demoPath);

  return {
    url: url.toString(),
    referralCode,
  };
}

function normalizeDemoAudience(value: unknown, lead?: DiallerLead | null): DemoAudience {
  if (value === 'team' || value === 'solo' || value === 'brokerage') return value;
  if (!lead) return 'team';

  const haystack = `${lead.name ?? ''} ${lead.company ?? ''} ${lead.notes ?? ''}`.toLowerCase();
  if (haystack.includes('classification: agency') || haystack.includes('classification: brokerage')) return 'brokerage';
  if (haystack.includes('real_estate_brokerage') || haystack.includes('brokerage')) return 'brokerage';
  if (haystack.includes('classification: individual_agent') || haystack.includes('individual_agent')) return 'solo';
  if (haystack.includes('real_estate_individual_agent')) return 'solo';
  if (haystack.includes('classification: team') || haystack.includes('real_estate_team')) return 'team';

  return 'team';
}

function getDemoAudienceCampaign(audience: DemoAudience): string {
  if (audience === 'solo') return 'individual-agent-listing';
  if (audience === 'brokerage') return 'brokerage-demo';
  return 'power-dialer-demo';
}

function getDemoAudiencePath(audience: DemoAudience): string {
  return audience === 'solo' ? LISTING_DEMO_VIDEO_PATH : DIALER_DEMO_VIDEO_PATH;
}

function buildSharedDialerDemoUrl(
  publicOrigin: string,
  referralCode: string | null,
  demoPath = DIALER_DEMO_VIDEO_PATH,
  campaign = 'power-dialer-demo'
): string {
  if (!referralCode) return new URL(demoPath, publicOrigin).toString();

  const url = new URL(`/s/${encodeURIComponent(referralCode)}`, publicOrigin);
  url.searchParams.set('source', 'salesperson');
  url.searchParams.set('campaign', campaign);
  url.searchParams.set('redirect', demoPath);
  return url.toString();
}

function buildBrokerageSignupUrl(publicOrigin: string, referralCode: string | null): string {
  const signupUrl = new URL('/onboarding', publicOrigin);
  signupUrl.searchParams.set('source', 'dialer');
  signupUrl.searchParams.set('campaign', 'brokerage-demo');
  if (referralCode) signupUrl.searchParams.set('referralCode', referralCode);
  return signupUrl.toString();
}

async function buildTrackedDialerDemoUrl(
  request: NextRequest,
  context: DiallerContext,
  salesperson: SalespersonReferralRow | null,
  lead: DiallerLead,
  contact: Record<string, unknown> | null
): Promise<{ url: string; referralCode: string | null; tracked: boolean }> {
  const publicOrigin = getPublicOrigin(request);
  const referralCode =
    normalizeSalespersonReferralCodeInput(salesperson?.referral_code ?? '') ||
    (await resolveSalespersonReferralCode(context));
  const fallbackUrl = buildSharedDialerDemoUrl(publicOrigin, referralCode);

  const trackedLink = await createTrackedDemoLink({
    admin: context.admin,
    origin: publicOrigin,
    salesperson,
    workspaceId: context.workspaceId,
    lead,
    contact,
    referralCode,
    source: 'salesperson',
    campaign: 'power-dialer-demo',
    destinationPath: DIALER_DEMO_VIDEO_PATH,
  });

  return {
    url: trackedLink?.url ?? fallbackUrl,
    referralCode,
    tracked: Boolean(trackedLink),
  };
}

function buildInterestedLinkText(lead: DiallerLead, demoUrl: string): string {
  const firstName = cleanText(lead.name).split(/\s+/)[0];
  const greeting = firstName ? `Hey ${firstName},` : 'Hey,';

  return [
    greeting,
    '',
    'Great connecting with you.',
    '',
    'I’ve attached a quick 90 second demo in this message.',
    '',
    demoUrl,
    '',
    'Take a look when you get the chance. I’m confident you’ll see how powerful this could be for your team, especially around tracking activity, managing leads, and keeping agents accountable in the field.',
    '',
    'If you have any questions at all, just text or call me.',
    '',
    'Thanks again!',
  ].join('\n');
}

function buildSoloInterestedLinkText(lead: DiallerLead, demoUrl: string): string {
  const firstName = cleanText(lead.name).split(/\s+/)[0];
  const greeting = firstName ? `Hey ${firstName},` : 'Hey,';

  return [
    greeting,
    '',
    'Great connecting with you.',
    '',
    'I’ve attached the quick individual-agent listing demo I mentioned.',
    '',
    demoUrl,
    '',
    'Take a look when you get the chance. It shows how an agent can use WolfGrid around listings, follow-up, and field prospecting.',
    '',
    'If you have any questions at all, just text or call me.',
    '',
    'Thanks again!',
  ].join('\n');
}

function buildBrokerageInterestedLinkText(params: {
  lead: DiallerLead;
  teamDemoUrl: string;
  listingDemoUrl: string;
  signupUrl: string;
}): string {
  const firstName = cleanText(params.lead.name).split(/\s+/)[0];
  const greeting = firstName ? `Hey ${firstName},` : 'Hey,';

  return [
    greeting,
    '',
    'Great connecting with you.',
    '',
    'Here are the quick WolfGrid links for your brokerage:',
    '',
    `Teams demo: ${params.teamDemoUrl}`,
    `Individual agent listing demo: ${params.listingDemoUrl}`,
    `Free trial: ${params.signupUrl}`,
    '',
    'If you know agents who could use this, feel free to share it with them.',
    '',
    'Thanks again!',
  ].join('\n');
}

function buildEmailHtmlFromText(text: string): string {
  const urlPattern = /(https?:\/\/[^\s<>"')]+)/g;
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => {
      const escaped = escapeHtml(paragraph)
        .replace(urlPattern, (url) => {
          return `<a href="${url}" style="color:#dc2626;text-decoration:underline;">${url}</a>`;
        })
        .replace(/\n/g, '<br />');
      return `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#374151;">${escaped}</p>`;
    })
    .join('');
}

function extractEmailCtas(text: string, demoUrl: string): Array<{ label: string; url: string }> {
  const seen = new Set<string>();
  const ctas: Array<{ label: string; url: string }> = [];

  for (const line of text.split('\n')) {
    const url = line.match(/https?:\/\/[^\s<>"')]+/)?.[0];
    if (!url || seen.has(url)) continue;

    const lowerLine = line.toLowerCase();
    let label = url === demoUrl ? 'Watch the demo' : 'Open link';
    if (lowerLine.includes('demo 1')) label = 'Watch Demo 1 - Teams';
    else if (lowerLine.includes('demo 2')) label = 'Watch Demo 2 - Listing';
    else if (lowerLine.includes('included campaign') || lowerLine.includes('sign up')) {
      label = 'Start with one campaign included';
    }

    seen.add(url);
    ctas.push({ label, url });
  }

  return ctas.slice(0, 3);
}

function buildBrokerageDemoEmailBody(params: {
  lead: DiallerLead;
  senderName: string;
  teamDemoUrl: string;
  listingDemoUrl: string;
  signupUrl: string;
}): string {
  const firstName = cleanText(params.lead.name).split(/\s+/)[0];
  const greetingName = firstName || 'there';

  return [
    `Hey ${greetingName},`,
    '',
    'It was great connecting with you.',
    '',
    'I wanted to send over two quick WolfGrid demos that might be useful for your brokerage:',
    '',
    `Demo 1 - Teams: ${params.teamDemoUrl}`,
    `Demo 2 - Individual Agent Listing: ${params.listingDemoUrl}`,
    '',
    `Agents can also start with one included campaign here: ${params.signupUrl}`,
    '',
    'I would be honoured if you shared this with any agents you think would benefit from it.',
    '',
    'Reply here with any questions and I will get back to you.',
    '',
    'Thanks,',
    params.senderName,
  ].join('\n');
}

function buildSoloDemoEmailBody(params: {
  lead: DiallerLead;
  senderName: string;
  demoUrl: string;
}): string {
  const firstName = cleanText(params.lead.name).split(/\s+/)[0];
  const greetingName = firstName || 'there';

  return [
    `Hey ${greetingName},`,
    '',
    'It was great connecting with you.',
    '',
    'Here is the quick WolfGrid listing demo I mentioned:',
    '',
    params.demoUrl,
    '',
    'It shows how an individual agent can use WolfGrid around listings, follow-up, and field prospecting.',
    '',
    'Reply here with any questions and I will get back to you.',
    '',
    `Thanks,`,
    params.senderName,
  ].join('\n');
}

function buildDemoEmailContent(
  lead: DiallerLead,
  demoUrl: string,
  senderName: string,
  overrides?: { subject?: string | null; body?: string | null }
): { subject: string; text: string; html: string } {
  const firstName = cleanText(lead.name).split(/\s+/)[0];
  const greetingName = firstName || 'there';
  const subject = cleanText(overrides?.subject) || 'Quick WolfGrid demo';
  const text = cleanText(overrides?.body) || [
    `Hey ${greetingName},`,
    '',
    `It was great connecting with you. Here is the quick WolfGrid demo I mentioned:`,
    '',
    demoUrl,
    '',
    'It shows how teams can track field activity, manage leads, and keep agents accountable from one place.',
    '',
    'Reply here with any questions and I will get back to you.',
    '',
    `Thanks,`,
    senderName,
  ].join('\n');
  const bodyHtml = buildEmailHtmlFromText(text);
  const ctas = extractEmailCtas(text, demoUrl);
  const ctaHtml = ctas
    .map((cta, index) => {
      const background = index === ctas.length - 1 && cta.label.includes('Start')
        ? '#dc2626'
        : '#111827';
      return `<p style="margin:0 0 12px;">
        <a href="${escapeHtml(cta.url)}" style="display:inline-block;background:${background};color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-size:15px;font-weight:700;">
          ${escapeHtml(cta.label)}
        </a>
      </p>`;
    })
    .join('');

  const escapedGreetingName = escapeHtml(greetingName);
  const escapedDemoUrl = escapeHtml(demoUrl);
  const html = `
    <div style="margin:0;padding:28px 18px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
      <div style="max-width:580px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <div style="padding:24px 28px 14px;border-bottom:1px solid #e5e7eb;">
          <div style="font-size:26px;line-height:1;font-weight:800;color:#111827;">WolfGrid</div>
          <h1 style="margin:12px 0 0;font-size:22px;line-height:1.25;color:#111827;font-weight:700;">Quick demo</h1>
        </div>
        <div style="padding:24px 28px;">
          ${bodyHtml || `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#374151;">Hey ${escapedGreetingName},</p>`}
          ${ctaHtml || (text.includes(demoUrl) ? '' : `<p style="margin:0 0 22px;">
            <a href="${escapedDemoUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-size:15px;font-weight:700;">
              Watch the demo
            </a>
          </p>`)}
          <p style="margin:22px 0 0;font-size:12px;line-height:1.55;color:#6b7280;word-break:break-all;">
            If the button does not work, use this link: <a href="${escapedDemoUrl}" style="color:#374151;text-decoration:underline;">${escapedDemoUrl}</a>
          </p>
        </div>
      </div>
    </div>
  `.trim();

  return { subject, text, html };
}

async function sendDemoEmail(
  request: NextRequest,
  context: DiallerContext,
  lead: DiallerLead,
  contact: Record<string, unknown> | null,
  overrides?: {
    subject?: string | null;
    body?: string | null;
    demoLinkToken?: string | null;
    demoAudience?: DemoAudience | null;
  }
): Promise<string | null> {
  const recipient = cleanText(lead.email);
  if (!recipient) return 'Lead saved, but no email address was added.';

  const apiKey = getEnv('RESEND_API_KEY');
  if (!apiKey) return 'Lead saved, but RESEND_API_KEY is not configured.';

  const salesperson = await resolveSalespersonForDemoEmail(context);
  const handleLookupAdmin = context.admin as unknown as HandleLookupClient;
  const handle = await resolveAvailableDemoEmailHandle(
    handleLookupAdmin,
    salesperson,
    context.requestUser.email
  );
  if (salesperson?.id && !cleanText(salesperson.demo_email_handle)) {
    const { error: handleSaveError } = await context.admin
      .from('salespeople')
      .update({ demo_email_handle: handle })
      .eq('id', salesperson.id)
      .is('demo_email_handle', null);

    if (handleSaveError) {
      console.warn('[dialer/leads] failed to store generated demo email handle', handleSaveError);
    }
  }

  const senderName = formatDemoSenderName(salesperson, context.requestUser.email);
  const from = `${senderName} <${handle}@${DEMO_EMAIL_DOMAIN}>`;
  const replyTo = cleanText(salesperson?.demo_email_reply_to) || cleanText(salesperson?.email) || cleanText(context.requestUser.email) || getEnv('RESEND_REPLY_TO');
  const cleanToken = cleanText(overrides?.demoLinkToken);
  const publicOrigin = getPublicOrigin(request);
  const audience = normalizeDemoAudience(overrides?.demoAudience, lead);
  let demo: { url: string; referralCode: string | null; tracked: boolean };
  if (audience === 'solo') {
    const referralCode = normalizeSalespersonReferralCodeInput(salesperson?.referral_code ?? '') || (await resolveSalespersonReferralCode(context));
    demo = {
      url: buildSharedDialerDemoUrl(
        publicOrigin,
        referralCode,
        LISTING_DEMO_VIDEO_PATH,
        getDemoAudienceCampaign('solo')
      ),
      referralCode,
      tracked: false,
    };
  } else {
    try {
      const generated = await generateDemoLinkForLead({
        admin: context.admin,
        leadId: lead.id,
        user: context.requestUser,
      });
      const generatedDestination = new URL(generated.url);
      const trackedLink = await createTrackedDemoLink({
        admin: context.admin,
        origin: publicOrigin,
        salesperson,
        workspaceId: context.workspaceId,
        lead,
        contact,
        referralCode: normalizeSalespersonReferralCodeInput(salesperson?.referral_code ?? '') || null,
        source: 'salesperson',
        campaign: 'power-dialer-demo',
        destinationPath: generatedDestination.pathname,
      });
      demo = {
        url: trackedLink?.url ?? generated.url,
        referralCode: normalizeSalespersonReferralCodeInput(salesperson?.referral_code ?? '') || null,
        tracked: Boolean(trackedLink),
      };
    } catch (generateError) {
      console.warn('[dialer/leads] demo engine link generation failed; falling back to legacy demo URL', generateError);
      demo = cleanToken
        ? {
            url: new URL(`/d/${encodeURIComponent(cleanToken)}`, publicOrigin).toString(),
            referralCode: normalizeSalespersonReferralCodeInput(salesperson?.referral_code ?? '') || null,
            tracked: true,
          }
        : await buildTrackedDialerDemoUrl(request, context, salesperson, lead, contact);
    }
  }
  const listingDemoUrl = buildSharedDialerDemoUrl(
    publicOrigin,
    demo.referralCode,
    LISTING_DEMO_VIDEO_PATH,
    'individual-agent-listing'
  );
  const signupUrl = buildBrokerageSignupUrl(publicOrigin, demo.referralCode);
  const fallbackBody = audience === 'brokerage'
    ? buildBrokerageDemoEmailBody({
        lead,
        senderName,
        teamDemoUrl: demo.url,
        listingDemoUrl,
        signupUrl,
      })
    : audience === 'solo'
      ? buildSoloDemoEmailBody({ lead, senderName, demoUrl: demo.url })
      : null;
  const contactId = typeof contact?.id === 'string' ? contact.id : null;
  if (cleanToken) {
    const { error: linkUpdateError } = await context.admin
      .from('salesperson_demo_links')
      .update({
        contact_id: contactId,
        recipient_email: recipient.toLowerCase(),
        recipient_name: cleanText(lead.name) || null,
      })
      .eq('token', cleanToken)
      .eq('workspace_id', context.workspaceId);
    if (linkUpdateError) {
      console.warn('[dialer/leads] failed to attach demo link to contact', linkUpdateError);
    }
  }
  const content = buildDemoEmailContent(lead, demo.url, senderName, {
    subject: overrides?.subject ?? (audience === 'brokerage' ? 'Two quick WolfGrid demos for your agents' : audience === 'solo' ? 'Quick WolfGrid listing demo' : null),
    body: overrides?.body ?? fallbackBody,
  });
  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from,
    to: recipient,
    subject: content.subject,
    text: content.text,
    html: content.html,
    ...(replyTo ? { replyTo } : {}),
  });

  if (error) {
    const message = error.message?.trim() || 'Resend email request failed';
    return `Lead saved, but the demo email was not sent. ${message}`;
  }

  if (contactId) {
    const now = new Date().toISOString();
    const { error: activityError } = await context.admin.from('contact_activities').insert({
      contact_id: contactId,
      type: 'email',
      note: `Demo email sent: ${content.subject}\n${demo.url}${demo.tracked ? '\nTracked to recipient-specific demo link.' : ''}`,
      timestamp: now,
    });
    if (activityError) console.warn('[dialer/leads] failed to log demo email activity', activityError);
  }

  return data?.id
    ? null
    : 'Demo email sent, but Resend did not return a message id.';
}

async function sendInterestedLink(
  request: NextRequest,
  context: DiallerContext,
  lead: DiallerLead,
  demoAudience?: DemoAudience | null
): Promise<string | null> {
  const normalizedPhone = normalizeDiallerLeadPhone(lead);
  if (!normalizedPhone.e164) return 'Lead saved, but the phone number is not valid for SMS.';
  const from = await resolveDiallerSmsFromNumber(context, normalizedPhone.e164);
  if (!from) return 'Lead saved, but no SMS-enabled dialer number is configured.';

  const audience = normalizeDemoAudience(demoAudience, lead);
  const demo = await buildDialerDemoUrl(request, context, {
    demoPath: getDemoAudiencePath(audience),
    campaign: getDemoAudienceCampaign(audience),
  });
  const publicOrigin = getPublicOrigin(request);
  const listingDemoUrl = buildSharedDialerDemoUrl(
    publicOrigin,
    demo.referralCode,
    LISTING_DEMO_VIDEO_PATH,
    getDemoAudienceCampaign('solo')
  );
  const signupUrl = buildBrokerageSignupUrl(publicOrigin, demo.referralCode);
  const messageBody = audience === 'brokerage'
    ? buildBrokerageInterestedLinkText({
        lead,
        teamDemoUrl: demo.url,
        listingDemoUrl,
        signupUrl,
      })
    : audience === 'solo'
      ? buildSoloInterestedLinkText(lead, demo.url)
      : buildInterestedLinkText(lead, demo.url);
  const message = await sendDialerSms(request, {
    from,
    to: normalizedPhone.e164,
    body: messageBody,
  });

  const now = new Date().toISOString();
  const [{ error: insertError }, { error: activityError }] = await Promise.all([
    context.admin.from('dialer_sms_followups').insert({
      workspace_id: context.workspaceId,
      call_id: null,
      contact_id: null,
      sales_lead_id: lead.id,
      user_id: context.requestUser.id,
      telecom_provider: message.provider,
      provider_message_id: message.messageId,
      twilio_message_sid: message.provider === 'twilio' ? message.messageId : null,
      from_number_e164: from,
      to_number_e164: normalizedPhone.e164,
      body: messageBody,
      status: message.status,
      sent_at: now,
      status_payload: {
        ...message.raw,
        provider: message.provider,
        source: 'dialler_lead_interested_link',
        diallerLeadId: lead.id,
        referralCode: demo.referralCode,
      },
    }),
    context.admin.from('sales_activities').insert({
      workspace_id: context.workspaceId,
      sales_lead_id: lead.id,
      actor_user_id: context.requestUser.id,
      activity_type: 'text',
      note: audience === 'brokerage'
        ? `Brokerage demo SMS sent:\n${demo.url}\n${listingDemoUrl}\n${signupUrl}`
        : `Demo SMS sent: ${demo.url}`,
      occurred_at: now,
    }),
  ]);

  if (activityError) {
    console.warn('[dialer/leads] failed to log interested link text activity', activityError);
  }

  if (insertError) {
    console.error('[dialer/leads] failed to save interested link text', insertError);
    return 'Demo sent, but WolfGrid could not save the text record.';
  }

  return demo.referralCode
    ? null
    : 'Demo sent, but no active salesperson referral code was found for this account.';
}

function cleanIsoDate(value: string | null | undefined): string | null {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  const date = new Date(cleaned);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getDiallerLeadIdFromCallPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const leadId = (payload as Record<string, unknown>).diallerLeadId;
  return typeof leadId === 'string' && UUID_PATTERN.test(leadId) ? leadId : null;
}

function deriveDiallerLeadCallOutcome(call: DiallerLeadCallRow | null): DiallerLeadCallOutcome {
  if (!call) return 'pending';
  if (call.answered_at || call.status === 'answered' || call.status === 'in-progress') return 'answered';
  if (call.status === 'completed') return call.answered_at ? 'answered' : 'no_answer';
  if (['no-answer', 'busy', 'failed', 'canceled'].includes(call.status ?? '')) return 'no_answer';
  return 'pending';
}

function isTerminalDialerCallStatus(status: DialerCallStatus | null | undefined): boolean {
  return status === 'completed' || status === 'no-answer' || status === 'busy' || status === 'failed' || status === 'canceled';
}

function shouldKeepDiallerLeadInQueue(lead: DiallerLead): boolean {
  if (lead.disposition || lead.called_at) return false;
  if (
    lead.latest_call_outcome &&
    lead.latest_call_outcome !== 'pending' &&
    (lead.latest_call_ended_at || isTerminalDialerCallStatus(lead.latest_call_status))
  ) {
    return false;
  }
  return true;
}

async function findReusableDiallerLeadForMaster(context: DiallerContext, masterLead: MasterLeadRow | null): Promise<DiallerLead | null> {
  if (!masterLead || masterLead.assigned_user_id !== context.requestUser.id) return null;

  if (masterLead.dialler_lead_id) {
    const { data, error } = await context.admin
      .from('sales_leads')
      .select('*')
      .eq('id', masterLead.dialler_lead_id)
      .eq('workspace_id', context.workspaceId)
      .eq('user_id', context.requestUser.id)
      .maybeSingle();

    if (!error && data && shouldKeepDiallerLeadInQueue(data as DiallerLead)) {
      return data as DiallerLead;
    }

    if (error && error.code !== 'PGRST116') {
      console.warn('[dialer/leads] reusable dialler lead lookup failed', error);
    }
  }

  return null;
}

function isMasterLeadAssignedToCurrentUser(context: DiallerContext, masterLead: MasterLeadRow | null): boolean {
  return masterLead?.assigned_user_id === context.requestUser.id;
}

async function attachLatestCallOutcomes(
  context: DiallerContext,
  leads: DiallerLead[]
): Promise<DiallerLead[]> {
  const leadIds = new Set(leads.map((lead) => lead.id));
  if (leadIds.size === 0) return leads;

  const { data, error } = await context.admin
    .from('dialer_calls')
    .select('id,status,answered_at,ended_at,created_at,status_payload')
    .eq('workspace_id', context.workspaceId)
    .eq('user_id', context.requestUser.id)
    .in('status_payload->>diallerLeadId', Array.from(leadIds))
    .order('created_at', { ascending: false })
    .limit(Math.max(leadIds.size * 4, 100));

  if (error) {
    console.warn('[dialer/leads] failed to load latest call outcomes', error);
    return leads;
  }

  const latestCallByLeadId = new Map<string, DiallerLeadCallRow>();
  for (const call of (data ?? []) as DiallerLeadCallRow[]) {
    const leadId = getDiallerLeadIdFromCallPayload(call.status_payload);
    if (!leadId || !leadIds.has(leadId) || latestCallByLeadId.has(leadId)) continue;
    latestCallByLeadId.set(leadId, call);
  }

  return leads.map((lead) => {
    const latestCall = latestCallByLeadId.get(lead.id) ?? null;
    return {
      ...lead,
      latest_call_id: latestCall?.id ?? null,
      latest_call_status: latestCall?.status ?? null,
      latest_call_outcome: deriveDiallerLeadCallOutcome(latestCall),
      latest_call_answered_at: latestCall?.answered_at ?? null,
      latest_call_ended_at: latestCall?.ended_at ?? null,
      latest_call_created_at: latestCall?.created_at ?? null,
      latest_call_recording: latestCall ? getDialerCallRecordingSummary(latestCall) : null,
    };
  });
}

async function findExistingContact(context: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
}, lead: DiallerLead): Promise<Record<string, unknown> | null> {
  const normalizedPhone = normalizeDiallerLeadPhone(lead);
  const lookups = [
    normalizedPhone.e164 ? { column: 'phone_e164', value: normalizedPhone.e164 } : null,
    cleanText(lead.phone) ? { column: 'phone', value: cleanText(lead.phone) } : null,
    cleanText(lead.email) ? { column: 'email', value: cleanText(lead.email) } : null,
  ].filter((lookup): lookup is { column: string; value: string } => Boolean(lookup));

  for (const lookup of lookups) {
    const { data, error } = await context.admin
      .from('contacts')
      .select('*')
      .eq('workspace_id', context.workspaceId)
      .eq(lookup.column, lookup.value)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!error && data) return data as Record<string, unknown>;
    if (error && error.code !== 'PGRST116') {
      console.warn('[dialer/leads] contact lookup failed', error);
    }
  }

  return null;
}

async function syncContactFollowUpCalendarEvent(context: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
  requestUser: { id: string };
}, contact: Record<string, unknown>, followUpAt: string | null, notes: string | null): Promise<void> {
  const contactId = typeof contact.id === 'string' ? contact.id : null;
  if (!contactId || !followUpAt) return;

  const startAt = new Date(followUpAt);
  if (Number.isNaN(startAt.getTime())) return;
  const endAt = new Date(startAt.getTime() + 30 * 60 * 1000);
  const fullName = typeof contact.full_name === 'string' && contact.full_name.trim() ? contact.full_name.trim() : 'Lead';
  const address = typeof contact.address === 'string' ? contact.address : '';
  const now = new Date().toISOString();
  const eventPayload = {
    user_id: context.requestUser.id,
    workspace_id: context.workspaceId,
    title: `Follow up: ${fullName}`,
    start_at: startAt.toISOString(),
    end_at: endAt.toISOString(),
    is_all_day: false,
    event_type: 'follow_up',
    contact_id: contactId,
    contact_name: fullName,
    contact_address: address,
    source_kind: 'contact_follow_up',
    source_id: contactId,
    notes,
    location: address || null,
    color_key: 'blue',
    deleted_at: null,
    updated_at: now,
  };

  const { data: existingEvent, error: lookupError } = await context.admin
    .from('calendar_events')
    .select('id')
    .eq('source_kind', 'contact_follow_up')
    .eq('source_id', contactId)
    .eq('event_type', 'follow_up')
    .maybeSingle();

  if (lookupError && lookupError.code !== 'PGRST116') {
    console.warn('[dialer/leads] calendar follow-up lookup failed', lookupError);
    return;
  }

  const result = existingEvent?.id
    ? await context.admin.from('calendar_events').update(eventPayload).eq('id', existingEvent.id)
    : await context.admin.from('calendar_events').insert({ ...eventPayload, created_at: now });

  if (result.error) {
    console.warn('[dialer/leads] calendar follow-up sync failed', result.error);
  }
}

async function upsertContactFollowUp(context: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
  requestUser: { id: string };
}, lead: DiallerLead, followUpAt: string | null, notes: string | null): Promise<string | null> {
  if (!followUpAt) return null;

  const normalizedPhone = normalizeDiallerLeadPhone(lead);
  const existing = await findExistingContact(context, lead);
  const now = new Date().toISOString();
  const contactPayload = {
    user_id: context.requestUser.id,
    workspace_id: context.workspaceId,
    full_name: cleanText(lead.name) || 'Lead',
    phone: cleanText(lead.phone) || null,
    phone_e164: normalizedPhone.e164,
    phone_country_code: normalizedPhone.countryCode,
    phone_area_code: normalizedPhone.areaCode,
    phone_area_label: normalizedPhone.areaLabel,
    email: cleanText(lead.email) || null,
    address: '',
    status: 'warm',
    notes,
    follow_up_at: followUpAt,
    reminder_date: followUpAt,
    last_contacted: now,
    updated_at: now,
  };

  const { data, error } = existing?.id
    ? await context.admin
        .from('contacts')
        .update(contactPayload)
        .eq('id', existing.id)
        .select('*')
        .single()
    : await context.admin
        .from('contacts')
        .insert({ ...contactPayload, created_at: now })
        .select('*')
        .single();

  if (error) {
    console.error('[dialer/leads] failed to upsert contact follow-up', error);
    return 'Callback saved, but it could not be added to Follow Up tasks.';
  }

  await syncContactFollowUpCalendarEvent(context, data as Record<string, unknown>, followUpAt, notes);
  return null;
}

async function upsertDiallerContact(context: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
  requestUser: { id: string };
}, lead: DiallerLead, notes: string | null): Promise<{ contact: Record<string, unknown> | null; warning: string | null }> {
  const normalizedPhone = normalizeDiallerLeadPhone(lead);
  const existing = await findExistingContact(context, lead);
  const now = new Date().toISOString();
  const contactPayload = {
    user_id: context.requestUser.id,
    workspace_id: context.workspaceId,
    full_name: cleanText(lead.name) || 'Lead',
    phone: cleanText(lead.phone) || null,
    phone_e164: normalizedPhone.e164,
    phone_country_code: normalizedPhone.countryCode,
    phone_area_code: normalizedPhone.areaCode,
    phone_area_label: normalizedPhone.areaLabel,
    phone_last_validated_at: now,
    phone_validation_error: normalizedPhone.error,
    email: cleanText(lead.email) || null,
    address: '',
    status: 'warm',
    notes,
    last_contacted: now,
    updated_at: now,
  };

  const { data, error } = existing?.id
    ? await context.admin
        .from('contacts')
        .update(contactPayload)
        .eq('id', existing.id)
        .select('*')
        .single()
    : await context.admin
        .from('contacts')
        .insert({ ...contactPayload, created_at: now })
        .select('*')
        .single();

  if (error) {
    console.error('[dialer/leads] failed to save dialler contact', error);
    return { contact: null, warning: 'Lead saved, but it could not be saved to Contacts.' };
  }

  return { contact: data as Record<string, unknown>, warning: null };
}

async function createFollowUpNotification(context: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
  requestUser: { id: string };
}, lead: DiallerLead, followUpName: string | null, followUpAt: string | null): Promise<string | null> {
  const title = followUpName || `Follow up with ${lead.name || 'lead'}`;
  const dueText = followUpAt ? new Date(followUpAt).toLocaleString() : 'soon';
  const { error } = await context.admin.from('notifications').insert({
    workspace_id: context.workspaceId,
    user_id: context.requestUser.id,
    type: 'dialler_follow_up',
    title,
    body: `Callback task for ${lead.name || 'lead'} due ${dueText}.`,
    data: {
      diallerLeadId: lead.id,
      phone: lead.phone,
      company: lead.company,
      email: lead.email,
      followUpAt,
    },
    read_at: null,
  });

  if (!error) return null;
  console.warn('[dialer/leads] failed to create follow-up notification', error);
  return 'Callback saved, but the notification could not be created.';
}

function shapeMissingTableError(error: { message?: string; code?: string } | null | undefined) {
  if (!error) return null;
  if (error.code === '42P01' || error.message?.toLowerCase().includes('sales_leads')) {
    return 'sales_leads is not ready yet. Run the latest Supabase migration.';
  }
  return null;
}

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get('workspaceId');
  const requestedIds = parseUuidList(request.nextUrl.searchParams.get('leadIds'));
  const context = await resolveDiallerContext(request, workspaceId);
  if (context instanceof NextResponse) return context;

  let query = context.admin
    .from('sales_leads')
    .select('*')
    .eq('workspace_id', context.workspaceId)
    .eq('user_id', context.requestUser.id)
    .order('created_at', { ascending: true });

  if (requestedIds.length > 0) {
    query = query.in('id', requestedIds);
  }

  const { data, error } = await query;

  if (error) {
    const tableError = shapeMissingTableError(error);
    console.error('[dialer/leads] failed to load dialler leads', error);
    return NextResponse.json({ error: tableError ?? 'Failed to load dialler leads' }, { status: 500 });
  }

  const leads = (data ?? []) as DiallerLead[];
  if (requestedIds.length === 0) {
    const leadsWithOutcomes = await attachLatestCallOutcomes(context, leads);
    return NextResponse.json({
      leads: leadsWithOutcomes.map(withDiallerListMetadata),
    });
  }

  const orderById = new Map(requestedIds.map((id, index) => [id, index]));
  if (leads.length === 0) {
    const { data: fallbackData, error: fallbackError } = await context.admin
      .from('sales_leads')
      .select('*')
      .in('id', requestedIds)
      .eq('user_id', context.requestUser.id);

    if (!fallbackError) {
      const fallbackLeads = (fallbackData ?? []) as DiallerLead[];
      const fallbackWorkspaceId = fallbackLeads
        .map((lead) => lead.workspace_id)
        .find((workspaceId): workspaceId is string => Boolean(workspaceId));

      if (fallbackWorkspaceId && fallbackWorkspaceId !== context.workspaceId) {
        const fallbackContext = await resolveDiallerContext(request, fallbackWorkspaceId);
        if (!(fallbackContext instanceof NextResponse)) {
          const accessibleLeads = fallbackLeads
            .filter(
              (lead) =>
                lead.workspace_id === fallbackContext.workspaceId &&
                lead.user_id === fallbackContext.requestUser.id
            )
            .sort((a, b) => (orderById.get(a.id) ?? 9999) - (orderById.get(b.id) ?? 9999));

          if (accessibleLeads.length > 0) {
            const accessibleLeadsWithOutcomes = await attachLatestCallOutcomes(fallbackContext, accessibleLeads);
            return NextResponse.json({
              leads: accessibleLeadsWithOutcomes.map(withDiallerListMetadata),
              focusedLeadIds: requestedIds,
              resolvedWorkspaceId: fallbackContext.workspaceId,
            });
          }
        }
      }
    } else {
      console.warn('[dialer/leads] focused lead fallback lookup failed', fallbackError);
    }
  }

  const focusedLeadsWithOutcomes = await attachLatestCallOutcomes(
    context,
    [...leads].sort((a, b) => (orderById.get(a.id) ?? 9999) - (orderById.get(b.id) ?? 9999))
  );
  return NextResponse.json({
    leads: focusedLeadsWithOutcomes.map(withDiallerListMetadata),
    focusedLeadIds: requestedIds,
    resolvedWorkspaceId: context.workspaceId,
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as ImportLeadPayload;
  const context = await resolveDiallerContext(request, body.workspaceId);
  if (context instanceof NextResponse) return context;

  const salesperson = await resolveSalespersonForDemoEmail(context);
  const phoneMarket = normalizePhoneMarket(body.phoneMarket);
  const isTestLeadImport = body.testLead === true;
  const rows = Array.isArray(body.leads) ? body.leads : [];
  let skippedMasterCount = 0;
  let reusedMasterCount = 0;
  let masterWarning: string | null = null;
  const inserts: DiallerLeadInsert[] = [];
  const reusedLeads: DiallerLead[] = [];

  for (const row of rows) {
    const phone = cleanText(row.phone);
    const normalizedPhone = normalizePhoneNumber(phone, phoneMarket as SupportedPhoneMarket);
    if (!normalizedPhone.isValid || !normalizedPhone.e164) continue;
    const masterResult = isTestLeadImport
      ? null
      : await ensureSalespersonLeadMaster(context.admin, {
          workspaceId: context.workspaceId,
          assignedUserId: context.requestUser.id,
          assignedSalespersonId: salesperson?.id ?? null,
          createdByUserId: context.requestUser.id,
          name: cleanText(row.name) || 'Lead',
          company: cleanText(row.company) || null,
          phone: normalizedPhone.e164,
          email: cleanText(row.email) || null,
          countryCode: normalizedPhone.countryCode,
          source: 'dialler_import',
          state: 'queued',
        });

    if (masterResult) {
      if (!masterResult.available) {
        masterWarning = masterWarning ?? masterResult.warning;
      } else if (masterResult.existing) {
        if (!isMasterLeadAssignedToCurrentUser(context, masterResult.row)) {
          skippedMasterCount += 1;
          continue;
        }

        const reusableLead =
          ((masterResult.row as unknown as DiallerLead | null) &&
          shouldKeepDiallerLeadInQueue(masterResult.row as unknown as DiallerLead))
            ? (masterResult.row as unknown as DiallerLead)
            : await findReusableDiallerLeadForMaster(context, masterResult.row);
        if (reusableLead) {
          reusedLeads.push(reusableLead);
          reusedMasterCount += 1;
          continue;
        }
      }

      if (masterResult.created && masterResult.row && isMasterLeadAssignedToCurrentUser(context, masterResult.row)) {
        reusedLeads.push(masterResult.row as unknown as DiallerLead);
        continue;
      }
    }

    inserts.push({
      workspace_id: context.workspaceId,
      user_id: context.requestUser.id,
      name: cleanText(row.name) || 'Lead',
      phone: normalizedPhone.e164,
      phone_e164: normalizedPhone.e164,
      phone_country_code: normalizedPhone.countryCode,
      phone_area_code: normalizedPhone.areaCode,
      phone_area_label: normalizedPhone.areaLabel,
      company: cleanText(row.company) || null,
      email: cleanText(row.email) || null,
      disposition: null,
      lead_state: 'queued',
      source: 'dialler_import',
      notes: null,
      called_at: null,
      master_lead_id: masterResult?.row?.id ?? null,
    });
  }

  if (inserts.length === 0 && reusedLeads.length === 0) {
    return NextResponse.json(
      {
        error: skippedMasterCount > 0
          ? 'Those leads are assigned to another agent in the master list.'
          : 'Import a CSV with at least one phone number.',
        skippedMasterCount,
        reusedMasterCount,
        warning: masterWarning,
      },
      { status: 400 }
    );
  }

  if (inserts.length === 0) {
    return NextResponse.json(
      {
        leads: reusedLeads,
        importedCount: reusedLeads.length,
        skippedMasterCount,
        reusedMasterCount,
        warning: masterWarning,
      },
      { status: 200 }
    );
  }

  const masterIdByPhone = new Map(
    inserts
      .map((lead) => [
        lead.phone_e164 || normalizePhoneNumber(lead.phone).e164 || lead.phone.trim(),
        lead.master_lead_id ?? null,
      ] as const)
      .filter(([phone, masterId]) => Boolean(phone && masterId))
  );
  const insertPayload = inserts.map((lead) => {
    const payload = { ...lead };
    delete (payload as { master_lead_id?: string | null }).master_lead_id;
    return payload;
  });
  const { data, error } = await context.admin
    .from('sales_leads')
    .insert(insertPayload)
    .select('*');

  if (error) {
    const tableError = shapeMissingTableError(error);
    console.error('[dialer/leads] failed to import dialler leads', error);
    return NextResponse.json({ error: tableError ?? 'Failed to import dialler leads' }, { status: 500 });
  }

  for (const lead of (data ?? []) as DiallerLead[]) {
    const phone = lead.phone_e164 || normalizePhoneNumber(lead.phone).e164 || lead.phone.trim();
    await attachDiallerLeadToMaster(context.admin, masterIdByPhone.get(phone), lead.id);
  }

  return NextResponse.json(
    {
      leads: [...reusedLeads, ...((data ?? []) as DiallerLead[])],
      importedCount: reusedLeads.length + (data?.length ?? inserts.length),
      skippedMasterCount,
      reusedMasterCount,
      warning: masterWarning,
    },
    { status: 201 }
  );
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as UpdateLeadPayload;
  const context = await resolveDiallerContext(request, body.workspaceId);
  if (context instanceof NextResponse) return context;

  if (!body.id) {
    return NextResponse.json({ error: 'Lead id is required.' }, { status: 400 });
  }

  if (typeof body.isStarred === 'boolean') {
    const { data, error } = await context.admin
      .from('sales_leads')
      .update({
        is_starred: body.isStarred,
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.id)
      .eq('workspace_id', context.workspaceId)
      .eq('user_id', context.requestUser.id)
      .select('*')
      .single();

    if (error) {
      const tableError = shapeMissingTableError(error);
      console.error('[dialer/leads] failed to update dialler lead star', error);
      return NextResponse.json({ error: tableError ?? 'Failed to update lead star' }, { status: 500 });
    }

    return NextResponse.json({ lead: data as DiallerLead });
  }

  if (body.markCalled) {
    const updatePayload: {
      called_at: string;
      updated_at: string;
      notes?: string | null;
      email?: string | null;
    } = {
      called_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (typeof body.notes === 'string') updatePayload.notes = cleanText(body.notes) || null;
    if (typeof body.email === 'string') updatePayload.email = cleanText(body.email) || null;

    const { data, error } = await context.admin
      .from('sales_leads')
      .update(updatePayload)
      .eq('id', body.id)
      .eq('workspace_id', context.workspaceId)
      .eq('user_id', context.requestUser.id)
      .select('*')
      .single();

    if (error) {
      const tableError = shapeMissingTableError(error);
      console.error('[dialer/leads] failed to mark dialler lead called', error);
      return NextResponse.json({ error: tableError ?? 'Failed to mark lead called' }, { status: 500 });
    }

    return NextResponse.json({ lead: data as DiallerLead });
  }

  if (body.saveContact) {
    const { data: existingLead, error: existingLeadError } = await context.admin
      .from('sales_leads')
      .select('*')
      .eq('id', body.id)
      .eq('workspace_id', context.workspaceId)
      .eq('user_id', context.requestUser.id)
      .maybeSingle();

    if (existingLeadError) {
      const tableError = shapeMissingTableError(existingLeadError);
      console.error('[dialer/leads] failed to load dialler lead for contact save', existingLeadError);
      return NextResponse.json({ error: tableError ?? 'Failed to load dialler lead' }, { status: 500 });
    }

    if (!existingLead) {
      return NextResponse.json({ error: 'Lead not found.' }, { status: 404 });
    }

    const { data, error } = await context.admin
      .from('sales_leads')
      .update({
        notes: cleanText(body.notes) || null,
        email: cleanText(body.email) || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.id)
      .eq('workspace_id', context.workspaceId)
      .eq('user_id', context.requestUser.id)
      .select('*')
      .single();

    if (error) {
      const tableError = shapeMissingTableError(error);
      console.error('[dialer/leads] failed to save dialler lead contact fields', error);
      return NextResponse.json({ error: tableError ?? 'Failed to save contact' }, { status: 500 });
    }

    if (!body.sendDemoEmail) {
      return NextResponse.json({
        lead: data as DiallerLead,
        contact: null,
        warning: 'Lead details saved in the dialer. It will move to Contacts after a text, email, or follow-up.',
      });
    }

    let warning: string | null = null;
    try {
      const emailWarning = await sendDemoEmail(request, context, data as DiallerLead, null, {
        subject: body.demoEmailSubject,
        body: body.demoEmailBody,
        demoLinkToken: body.demoLinkToken,
        demoAudience: body.demoAudience,
      });
      warning = warning ?? emailWarning;
    } catch (sendError) {
      console.error('[dialer/leads] failed to send demo email', sendError);
      warning = warning ?? (sendError instanceof Error ? sendError.message : 'Lead saved, but the demo email could not be sent.');
    }

    return NextResponse.json({
      lead: data as DiallerLead,
      contact: null,
      warning,
    });
  }

  if (!body.disposition || !VALID_DISPOSITIONS.has(body.disposition)) {
    return NextResponse.json({ error: 'Choose a valid disposition.' }, { status: 400 });
  }

  const { data, error } = await context.admin
    .from('sales_leads')
    .update({
      disposition: body.disposition,
      notes: cleanText(body.notes) || null,
      email: cleanText(body.email) || null,
      follow_up_name: cleanText(body.followUpName) || null,
      follow_up_at: cleanIsoDate(body.followUpAt),
      called_at: new Date().toISOString(),
    })
    .eq('id', body.id)
    .eq('workspace_id', context.workspaceId)
    .eq('user_id', context.requestUser.id)
    .select('*')
    .single();

  if (error) {
    const tableError = shapeMissingTableError(error);
    console.error('[dialer/leads] failed to save dialler lead', error);
    return NextResponse.json({ error: tableError ?? 'Failed to save dialler lead' }, { status: 500 });
  }

  let warning: string | null = null;
  if (body.sendLink) {
    try {
      warning = await sendInterestedLink(request, context, data as DiallerLead, body.demoAudience);
    } catch (sendError) {
      console.error('[dialer/leads] failed to send interested link', sendError);
      warning = sendError instanceof Error ? sendError.message : 'Lead saved, but the link text could not be sent.';
    }
  }

  if (body.createNotification) {
    const followUpAt = cleanIsoDate(body.followUpAt);
    const notificationWarning = await createFollowUpNotification(
      context,
      data as DiallerLead,
      cleanText(body.followUpName) || null,
      followUpAt
    );
    warning = warning ?? notificationWarning;
  }

  await updateMasterLeadDispositionForDiallerLead({
    admin: context.admin,
    lead: data as DiallerLead,
    disposition: body.disposition,
    notes: cleanText(body.notes) || null,
    nextFollowUpAt: cleanIsoDate(body.followUpAt),
  });

  return NextResponse.json({ lead: data as DiallerLead, warning });
}

export async function DELETE(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    workspaceId?: string;
    id?: string;
    ids?: string[];
    deleteAll?: boolean;
  };
  const context = await resolveDiallerContext(request, body.workspaceId);
  if (context instanceof NextResponse) return context;

  if (body.deleteAll) {
    const ids = Array.isArray(body.ids)
      ? Array.from(new Set(body.ids.map((id) => id.trim()).filter((id) => UUID_PATTERN.test(id)))).slice(0, 100)
      : [];
    let query = context.admin
      .from('sales_leads')
      .delete()
      .eq('workspace_id', context.workspaceId)
      .eq('user_id', context.requestUser.id);

    if (ids.length > 0) {
      query = query.in('id', ids);
    }

    const { data, error } = await query.select('id');

    if (error) {
      const tableError = shapeMissingTableError(error);
      console.error('[dialer/leads] failed to delete dialler lead list', error);
      return NextResponse.json({ error: tableError ?? 'Failed to delete dialler lead list' }, { status: 500 });
    }

    return NextResponse.json({ deletedCount: data?.length ?? 0 });
  }

  if (!body.id) {
    return NextResponse.json({ error: 'Lead id is required.' }, { status: 400 });
  }

  const { error } = await context.admin
    .from('sales_leads')
    .delete()
    .eq('id', body.id)
    .eq('workspace_id', context.workspaceId)
    .eq('user_id', context.requestUser.id);

  if (error) {
    const tableError = shapeMissingTableError(error);
    console.error('[dialer/leads] failed to delete dialler lead', error);
    return NextResponse.json({ error: tableError ?? 'Failed to delete dialler lead' }, { status: 500 });
  }

  return NextResponse.json({ deletedId: body.id });
}
