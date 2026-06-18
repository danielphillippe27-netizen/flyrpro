import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import twilio from 'twilio';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  resolveWorkspaceMembershipForUser,
  type MinimalSupabaseClient,
} from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';
import { isDialerFounderBypassEmail } from '@/lib/dialer/feature-gate';
import { getTwilioAccountSid, getTwilioAuthToken, getTwilioDefaultSmsFromNumber } from '@/lib/dialer/env';
import { normalizePhoneNumber } from '@/lib/dialer/phone';
import { buildPublicTwilioWebhookUrl } from '@/lib/dialer/server';
import {
  DEMO_EMAIL_DOMAIN,
  resolveAvailableDemoEmailHandle,
  type HandleLookupClient,
} from '@/lib/dialer/demo-email-handle';
import type { DiallerLead, DiallerLeadDisposition } from '@/types/database';
import {
  ensureSalespersonReferralCode,
  normalizeSalespersonReferralCodeInput,
} from '@/app/lib/billing/salespeople';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ImportLeadPayload = {
  workspaceId?: string;
  leads?: Array<{
    name?: string | null;
    phone?: string | null;
    company?: string | null;
    email?: string | null;
  }>;
};

type UpdateLeadPayload = {
  workspaceId?: string;
  id?: string;
  disposition?: DiallerLeadDisposition | null;
  notes?: string | null;
  email?: string | null;
  sendDemoEmail?: boolean;
  sendLink?: boolean;
  followUpName?: string | null;
  followUpAt?: string | null;
  createNotification?: boolean;
  saveContact?: boolean;
};

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
const FALLBACK_PUBLIC_ORIGIN = 'https://flyr.software';

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
  return cleanText(salesperson?.full_name) || cleanText(userEmail).split('@')[0] || 'FLYR';
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

async function buildDialerDemoUrl(request: NextRequest, context: DiallerContext): Promise<{
  url: string;
  referralCode: string | null;
}> {
  const publicOrigin = getPublicOrigin(request);
  const referralCode = await resolveSalespersonReferralCode(context);
  const demoPath = '/demo1';

  if (!referralCode) {
    return {
      url: new URL(demoPath, publicOrigin).toString(),
      referralCode: null,
    };
  }

  const url = new URL(`/s/${encodeURIComponent(referralCode)}`, publicOrigin);
  url.searchParams.set('source', 'salesperson');
  url.searchParams.set('campaign', 'power-dialer-demo');
  url.searchParams.set('redirect', demoPath);

  return {
    url: url.toString(),
    referralCode,
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

function buildDemoEmailContent(lead: DiallerLead, demoUrl: string, senderName: string): { subject: string; text: string; html: string } {
  const firstName = cleanText(lead.name).split(/\s+/)[0];
  const greetingName = firstName || 'there';
  const subject = 'Quick FLYR demo';
  const text = [
    `Hey ${greetingName},`,
    '',
    `It was great connecting with you. Here is the quick FLYR demo I mentioned:`,
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

  const escapedGreetingName = escapeHtml(greetingName);
  const escapedDemoUrl = escapeHtml(demoUrl);
  const escapedSenderName = escapeHtml(senderName);
  const html = `
    <div style="margin:0;padding:28px 18px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
      <div style="max-width:580px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <div style="padding:24px 28px 14px;border-bottom:1px solid #e5e7eb;">
          <div style="font-size:26px;line-height:1;font-weight:800;color:#111827;">FLYR</div>
          <h1 style="margin:12px 0 0;font-size:22px;line-height:1.25;color:#111827;font-weight:700;">Quick demo</h1>
        </div>
        <div style="padding:24px 28px;">
          <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#374151;">Hey ${escapedGreetingName},</p>
          <p style="margin:0 0 18px;font-size:15px;line-height:1.65;color:#374151;">It was great connecting with you. Here is the quick FLYR demo I mentioned.</p>
          <p style="margin:0 0 22px;">
            <a href="${escapedDemoUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-size:15px;font-weight:700;">
              Watch the demo
            </a>
          </p>
          <p style="margin:0 0 18px;font-size:15px;line-height:1.65;color:#374151;">It shows how teams can track field activity, manage leads, and keep agents accountable from one place.</p>
          <p style="margin:0 0 18px;font-size:15px;line-height:1.65;color:#374151;">Reply here with any questions and I will get back to you.</p>
          <p style="margin:0;font-size:15px;line-height:1.65;color:#374151;">Thanks,<br />${escapedSenderName}</p>
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
  contact: Record<string, unknown> | null
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
  const demo = await buildDialerDemoUrl(request, context);
  const content = buildDemoEmailContent(lead, demo.url, senderName);
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

  const contactId = typeof contact?.id === 'string' ? contact.id : null;
  if (contactId) {
    const now = new Date().toISOString();
    const { error: activityError } = await context.admin.from('contact_activities').insert({
      contact_id: contactId,
      type: 'email',
      note: `Demo email sent: ${content.subject}\n${demo.url}`,
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
  lead: DiallerLead
): Promise<string | null> {
  const from = getTwilioDefaultSmsFromNumber();
  if (!from) return 'Lead saved, but no SMS-enabled Twilio number is configured.';

  const normalizedPhone = normalizePhoneNumber(lead.phone);
  if (!normalizedPhone.e164) return 'Lead saved, but the phone number is not valid for SMS.';

  const demo = await buildDialerDemoUrl(request, context);
  const client = twilio(getTwilioAccountSid(), getTwilioAuthToken());
  const statusCallback = buildPublicTwilioWebhookUrl(request, '/api/twilio/messaging/status');
  await client.messages.create({
    from,
    to: normalizedPhone.e164,
    body: buildInterestedLinkText(lead, demo.url),
    statusCallback: statusCallback.toString(),
  });

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

async function findExistingContact(context: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
}, lead: DiallerLead): Promise<Record<string, unknown> | null> {
  const normalizedPhone = normalizePhoneNumber(lead.phone);
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

  const normalizedPhone = normalizePhoneNumber(lead.phone);
  const existing = await findExistingContact(context, lead);
  const now = new Date().toISOString();
  const contactPayload = {
    user_id: context.requestUser.id,
    workspace_id: context.workspaceId,
    full_name: cleanText(lead.name) || 'Lead',
    phone: cleanText(lead.phone) || null,
    phone_e164: normalizedPhone.e164,
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
  const normalizedPhone = normalizePhoneNumber(lead.phone);
  const existing = await findExistingContact(context, lead);
  const now = new Date().toISOString();
  const contactPayload = {
    user_id: context.requestUser.id,
    workspace_id: context.workspaceId,
    full_name: cleanText(lead.name) || 'Lead',
    phone: cleanText(lead.phone) || null,
    phone_e164: normalizedPhone.e164,
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
  if (error.code === '42P01' || error.message?.toLowerCase().includes('dialler_leads')) {
    return 'dialler_leads is not ready yet. Run the latest Supabase migration.';
  }
  return null;
}

export async function GET(request: NextRequest) {
  const workspaceId = request.nextUrl.searchParams.get('workspaceId');
  const requestedIds = parseUuidList(request.nextUrl.searchParams.get('leadIds'));
  const context = await resolveDiallerContext(request, workspaceId);
  if (context instanceof NextResponse) return context;

  let query = context.admin
    .from('dialler_leads')
    .select('*')
    .eq('workspace_id', context.workspaceId)
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
    return NextResponse.json({ leads });
  }

  const orderById = new Map(requestedIds.map((id, index) => [id, index]));
  return NextResponse.json({
    leads: [...leads].sort((a, b) => (orderById.get(a.id) ?? 9999) - (orderById.get(b.id) ?? 9999)),
    focusedLeadIds: requestedIds,
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as ImportLeadPayload;
  const context = await resolveDiallerContext(request, body.workspaceId);
  if (context instanceof NextResponse) return context;

  const rows = Array.isArray(body.leads) ? body.leads : [];
  const inserts = rows
    .flatMap((row) => {
      const phone = cleanText(row.phone);
      if (!normalizePhoneNumber(phone).isValid) return [];
      return [{
        workspace_id: context.workspaceId,
        name: cleanText(row.name) || 'Lead',
        phone,
        company: cleanText(row.company) || null,
        email: cleanText(row.email) || null,
        disposition: null,
        notes: null,
        called_at: null,
      }];
    });

  if (inserts.length === 0) {
    return NextResponse.json({ error: 'Import a CSV with at least one phone number.' }, { status: 400 });
  }

  const { data, error } = await context.admin
    .from('dialler_leads')
    .insert(inserts)
    .select('*');

  if (error) {
    const tableError = shapeMissingTableError(error);
    console.error('[dialer/leads] failed to import dialler leads', error);
    return NextResponse.json({ error: tableError ?? 'Failed to import dialler leads' }, { status: 500 });
  }

  return NextResponse.json({ leads: (data ?? []) as DiallerLead[], importedCount: data?.length ?? inserts.length }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as UpdateLeadPayload;
  const context = await resolveDiallerContext(request, body.workspaceId);
  if (context instanceof NextResponse) return context;

  if (!body.id) {
    return NextResponse.json({ error: 'Lead id is required.' }, { status: 400 });
  }

  if (body.saveContact) {
    const { data: existingLead, error: existingLeadError } = await context.admin
      .from('dialler_leads')
      .select('*')
      .eq('id', body.id)
      .eq('workspace_id', context.workspaceId)
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
      .from('dialler_leads')
      .update({
        notes: cleanText(body.notes) || null,
        email: cleanText(body.email) || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', body.id)
      .eq('workspace_id', context.workspaceId)
      .select('*')
      .single();

    if (error) {
      const tableError = shapeMissingTableError(error);
      console.error('[dialer/leads] failed to save dialler lead contact fields', error);
      return NextResponse.json({ error: tableError ?? 'Failed to save contact' }, { status: 500 });
    }

    const contactSave = await upsertDiallerContact(
      context,
      data as DiallerLead,
      cleanText(body.notes) || null
    );

    let warning = contactSave.warning;
    if (body.sendDemoEmail) {
      try {
        const emailWarning = await sendDemoEmail(request, context, data as DiallerLead, contactSave.contact);
        warning = warning ?? emailWarning;
      } catch (sendError) {
        console.error('[dialer/leads] failed to send demo email', sendError);
        warning = warning ?? (sendError instanceof Error ? sendError.message : 'Lead saved, but the demo email could not be sent.');
      }
    }

    return NextResponse.json({
      lead: data as DiallerLead,
      contact: contactSave.contact,
      warning,
    });
  }

  if (!body.disposition || !VALID_DISPOSITIONS.has(body.disposition)) {
    return NextResponse.json({ error: 'Choose a valid disposition.' }, { status: 400 });
  }

  const { data, error } = await context.admin
    .from('dialler_leads')
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
      warning = await sendInterestedLink(request, context, data as DiallerLead);
    } catch (sendError) {
      console.error('[dialer/leads] failed to send interested link', sendError);
      warning = sendError instanceof Error ? sendError.message : 'Lead saved, but the link text could not be sent.';
    }

    const contactSave = await upsertDiallerContact(
      context,
      data as DiallerLead,
      cleanText(body.notes) || null
    );
    warning = warning ?? contactSave.warning;
  }

  if (body.createNotification) {
    const followUpAt = cleanIsoDate(body.followUpAt);
    const contactWarning = await upsertContactFollowUp(
      context,
      data as DiallerLead,
      followUpAt,
      cleanText(body.notes) || null
    );
    const notificationWarning = await createFollowUpNotification(
      context,
      data as DiallerLead,
      cleanText(body.followUpName) || null,
      followUpAt
    );
    warning = warning ?? contactWarning ?? notificationWarning;
  }

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
      .from('dialler_leads')
      .delete()
      .eq('workspace_id', context.workspaceId);

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
    .from('dialler_leads')
    .delete()
    .eq('id', body.id)
    .eq('workspace_id', context.workspaceId);

  if (error) {
    const tableError = shapeMissingTableError(error);
    console.error('[dialer/leads] failed to delete dialler lead', error);
    return NextResponse.json({ error: tableError ?? 'Failed to delete dialler lead' }, { status: 500 });
  }

  return NextResponse.json({ deletedId: body.id });
}
