import { NextRequest, NextResponse } from 'next/server';
import { Resend, type GetReceivingEmailResponseSuccess, type WebhookEventPayload } from 'resend';
import { createAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SalespersonInboxRouteRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  workspace_id: string | null;
  demo_email_handle: string | null;
  demo_email_reply_to: string | null;
};

type ResendEmailReceivedEvent = Extract<WebhookEventPayload, { type: 'email.received' }>;

const INBOUND_DOMAIN = 'flyr.software';

function getEnv(name: string): string | null {
  const value = process.env[name];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function cleanText(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function extractEmailAddress(value: string | null | undefined): string | null {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  const angleMatch = cleaned.match(/<([^>]+)>/);
  const candidate = (angleMatch?.[1] ?? cleaned).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate) ? candidate : null;
}

function extractDisplayName(value: string | null | undefined): string | null {
  const cleaned = cleanText(value);
  if (!cleaned) return null;
  const angleIndex = cleaned.indexOf('<');
  const name = angleIndex > 0 ? cleaned.slice(0, angleIndex).trim().replace(/^"|"$/g, '') : '';
  return name || null;
}

function localPart(address: string | null | undefined): string | null {
  const email = extractEmailAddress(address) ?? cleanText(address).toLowerCase();
  const local = email.split('@')[0]?.split('+')[0]?.trim();
  return local || null;
}

function normalizeToAddresses(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
        .filter(Boolean)
    : [];
}

function getReceivedAt(value: string | null | undefined): string {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

function buildBodyText(email: GetReceivingEmailResponseSuccess | null, eventData: ResendEmailReceivedEvent['data']): string | null {
  const text = cleanText(email?.text);
  if (text) return text;
  const htmlText = cleanText(email?.html ? stripHtml(email.html) : null);
  if (htmlText) return htmlText;
  return cleanText(eventData.subject) || null;
}

function buildPreview(value: string | null): string | null {
  const cleaned = cleanText(value).replace(/\s+/g, ' ');
  return cleaned ? cleaned.slice(0, 280) : null;
}

function getAppOrigin(): string {
  return (
    getEnv('APP_BASE_URL') ||
    getEnv('NEXT_PUBLIC_APP_URL') ||
    'https://flyrpro.app'
  ).replace(/\/$/, '');
}

function getForwardFromEmail(): string {
  return getEnv('RESEND_INBOUND_FORWARD_FROM') || getEnv('RESEND_FROM_EMAIL') || 'FLYR Inbox <inbox@flyr.software>';
}

function shouldForwardToAddress(forwardTo: string | null, routableAddresses: string[], fromEmail: string | null): forwardTo is string {
  if (!forwardTo) return false;
  const normalizedForwardTo = forwardTo.toLowerCase();
  if (fromEmail && normalizedForwardTo === fromEmail.toLowerCase()) return false;
  return !routableAddresses.some((address) => extractEmailAddress(address) === normalizedForwardTo);
}

async function verifyResendWebhook(request: NextRequest, payload: string): Promise<WebhookEventPayload | null> {
  const webhookSecret = getEnv('RESEND_WEBHOOK_SECRET');
  if (!webhookSecret) {
    return JSON.parse(payload) as WebhookEventPayload;
  }

  const resend = new Resend(getEnv('RESEND_API_KEY') ?? 're_');
  return resend.webhooks.verify({
    payload,
    webhookSecret,
    headers: {
      id: request.headers.get('svix-id') ?? '',
      timestamp: request.headers.get('svix-timestamp') ?? '',
      signature: request.headers.get('svix-signature') ?? '',
    },
  });
}

async function fetchFullEmail(emailId: string): Promise<GetReceivingEmailResponseSuccess | null> {
  const apiKey = getEnv('RESEND_API_KEY');
  if (!apiKey) return null;

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.receiving.get(emailId);
  if (error) {
    console.warn('[email/inbound/resend] failed to fetch full email', error);
    return null;
  }
  return data ?? null;
}

async function resolveSalesperson(admin: ReturnType<typeof createAdminClient>, toAddresses: string[]): Promise<SalespersonInboxRouteRow | null> {
  const handles = Array.from(new Set(toAddresses.map(localPart).filter((value): value is string => Boolean(value))));
  if (handles.length === 0) return null;

  const { data, error } = await admin
    .from('salespeople')
    .select('id, full_name, email, workspace_id, demo_email_handle, demo_email_reply_to')
    .in('demo_email_handle', handles)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (error) {
    console.warn('[email/inbound/resend] salesperson handle lookup failed', error);
    return null;
  }

  return data as SalespersonInboxRouteRow | null;
}

async function forwardInboundEmail(context: {
  salesperson: SalespersonInboxRouteRow;
  inboxItemId: string;
  routableAddresses: string[];
  fromEmail: string | null;
  fromLabel: string | null;
  subject: string;
  body: string | null;
  preview: string | null;
  occurredAt: string;
}) {
  const apiKey = getEnv('RESEND_API_KEY');
  if (!apiKey) return;

  const forwardTo = extractEmailAddress(context.salesperson.demo_email_reply_to || context.salesperson.email);
  if (!shouldForwardToAddress(forwardTo, context.routableAddresses, context.fromEmail)) return;

  const resend = new Resend(apiKey);
  const originalRecipient = context.routableAddresses[0] ?? 'the FLYR inbox';
  const inboxUrl = `${getAppOrigin()}/inbox`;
  const subject = context.subject.startsWith('Fwd:') ? context.subject : `Fwd: ${context.subject}`;
  const fromLabel = context.fromLabel || context.fromEmail || 'Unknown sender';
  const body = context.body || context.preview || '';
  const text = [
    `FLYR received a reply for ${originalRecipient}.`,
    '',
    `From: ${fromLabel}${context.fromEmail && context.fromEmail !== fromLabel ? ` <${context.fromEmail}>` : ''}`,
    `To: ${originalRecipient}`,
    `Received: ${new Date(context.occurredAt).toLocaleString()}`,
    `Subject: ${context.subject}`,
    '',
    'Reply directly to this email to respond to the sender.',
    `Open in FLYR: ${inboxUrl}`,
    '',
    '--- Original message ---',
    body,
  ].join('\n');

  const html = `
    <div style="margin:0;padding:28px 18px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111827;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
        <div style="padding:22px 24px;border-bottom:1px solid #e5e7eb;">
          <div style="font-size:13px;font-weight:800;letter-spacing:.08em;color:#6b7280;text-transform:uppercase;">FLYR Inbox</div>
          <h1 style="margin:8px 0 0;font-size:21px;line-height:1.3;color:#111827;">${escapeHtml(context.subject)}</h1>
        </div>
        <div style="padding:22px 24px;">
          <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#4b5563;">FLYR received a reply for <strong style="color:#111827;">${escapeHtml(originalRecipient)}</strong>.</p>
          <div style="margin:0 0 18px;padding:12px 14px;border-radius:10px;background:#f3f4f6;border:1px solid #e5e7eb;font-size:14px;line-height:1.6;color:#374151;">
            <div><strong>From:</strong> ${escapeHtml(fromLabel)}${context.fromEmail && context.fromEmail !== fromLabel ? ` &lt;${escapeHtml(context.fromEmail)}&gt;` : ''}</div>
            <div><strong>To:</strong> ${escapeHtml(originalRecipient)}</div>
            <div><strong>Received:</strong> ${escapeHtml(new Date(context.occurredAt).toLocaleString())}</div>
          </div>
          <p style="margin:0 0 18px;">
            <a href="${escapeHtml(inboxUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:11px 16px;border-radius:9px;font-size:14px;font-weight:700;">Open in FLYR</a>
          </p>
          <div style="margin:0;padding:16px;border-left:3px solid #d1d5db;background:#fafafa;color:#1f2937;font-size:15px;line-height:1.65;white-space:pre-wrap;">${escapeHtml(body)}</div>
        </div>
      </div>
    </div>
  `.trim();

  const { error } = await resend.emails.send({
    from: getForwardFromEmail(),
    to: forwardTo,
    subject,
    text,
    html,
    ...(context.fromEmail ? { replyTo: context.fromEmail } : {}),
  });

  if (error) {
    console.warn('[email/inbound/resend] failed to forward inbound email', {
      inboxItemId: context.inboxItemId,
      forwardTo,
      error,
    });
  }
}

async function findContactByEmail(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  fromEmail: string | null
): Promise<Record<string, unknown> | null> {
  if (!fromEmail) return null;

  const { data, error } = await admin
    .from('contacts')
    .select('id, full_name, email')
    .eq('workspace_id', workspaceId)
    .ilike('email', fromEmail)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.warn('[email/inbound/resend] contact email lookup failed', error);
  }

  return (data as Record<string, unknown> | null) ?? null;
}

async function notifyWorkspaceMembers(context: {
  admin: ReturnType<typeof createAdminClient>;
  workspaceId: string;
  inboxItemId: string;
  fromLabel: string | null;
  subject: string;
  preview: string | null;
}) {
  const { data: members, error } = await context.admin
    .from('workspace_members')
    .select('user_id')
    .eq('workspace_id', context.workspaceId);

  if (error || !members?.length) {
    if (error) console.warn('[email/inbound/resend] workspace member lookup failed', error);
    return;
  }

  const notificationRows = members.flatMap((member) => {
    const userId = typeof member.user_id === 'string' ? member.user_id : null;
    if (!userId) return [];
    return [{
      workspace_id: context.workspaceId,
      user_id: userId,
      type: 'inbox_email_received',
      title: context.fromLabel ? `Email from ${context.fromLabel}` : 'New email reply',
      body: context.preview || context.subject,
      data: {
        inboxItemId: context.inboxItemId,
        source: 'email',
      },
      read_at: null,
    }];
  });

  if (notificationRows.length === 0) return;
  const { error: notificationError } = await context.admin.from('notifications').insert(notificationRows);
  if (notificationError) {
    console.warn('[email/inbound/resend] notification create failed', notificationError);
  }
}

export async function POST(request: NextRequest) {
  const payload = await request.text();
  let event: WebhookEventPayload | null = null;

  try {
    event = await verifyResendWebhook(request, payload);
  } catch (error) {
    console.warn('[email/inbound/resend] invalid webhook signature or payload', error);
    return NextResponse.json({ error: 'Invalid webhook' }, { status: 400 });
  }

  if (!event || event.type !== 'email.received') {
    return NextResponse.json({ ok: true });
  }

  const eventData = (event as ResendEmailReceivedEvent).data;
  const emailId = cleanText(eventData.email_id);
  if (!emailId) return NextResponse.json({ ok: true });

  const fullEmail = await fetchFullEmail(emailId);
  const toAddresses = normalizeToAddresses(fullEmail?.to ?? eventData.to);
  const receivingDomain = getEnv('RESEND_INBOUND_DOMAIN') ?? INBOUND_DOMAIN;
  const relevantToAddresses = toAddresses.filter((address) => address.endsWith(`@${receivingDomain}`) || address.includes(`@${receivingDomain}`));
  const routableAddresses = relevantToAddresses.length > 0 ? relevantToAddresses : toAddresses;
  const admin = createAdminClient();
  const salesperson = await resolveSalesperson(admin, routableAddresses);

  if (!salesperson?.workspace_id) {
    console.warn('[email/inbound/resend] no salesperson/workspace matched inbound email', {
      emailId,
      toAddresses,
    });
    return NextResponse.json({ ok: true, matched: false });
  }
  const workspaceId = salesperson.workspace_id;

  const fromRaw = fullEmail?.from ?? eventData.from;
  const fromEmail = extractEmailAddress(fromRaw);
  const fromLabel = extractDisplayName(fromRaw) || fromEmail;
  const contact = await findContactByEmail(admin, workspaceId, fromEmail);
  const contactId = typeof contact?.id === 'string' ? contact.id : null;
  const subject = cleanText(fullEmail?.subject ?? eventData.subject) || 'Inbound email';
  const body = buildBodyText(fullEmail, eventData);
  const preview = buildPreview(body);
  const occurredAt = getReceivedAt(fullEmail?.created_at ?? eventData.created_at);

  const inboxPayload = {
    workspace_id: workspaceId,
    salesperson_id: salesperson?.id ?? null,
    contact_id: contactId,
    source: 'email',
    source_table: 'resend_received_emails',
    source_id: emailId,
    external_id: emailId,
    title: subject,
    preview,
    body,
    from_label: fromLabel,
    from_email: fromEmail,
    to_label: salesperson?.full_name ?? null,
    to_email: routableAddresses[0] ?? null,
    status: 'open',
    priority: 'normal',
    occurred_at: occurredAt,
    raw_payload: {
      event,
      fullEmail: fullEmail
        ? {
            id: fullEmail.id,
            to: fullEmail.to,
            from: fullEmail.from,
            cc: fullEmail.cc,
            bcc: fullEmail.bcc,
            reply_to: fullEmail.reply_to,
            message_id: fullEmail.message_id,
            headers: fullEmail.headers,
            attachments: fullEmail.attachments,
            raw: fullEmail.raw,
          }
        : null,
    },
  };

  const { data: inboxItem, error: inboxError } = await admin
    .from('inbox_items')
    .upsert(inboxPayload, { onConflict: 'workspace_id,source,source_table,source_id' })
    .select('id')
    .single();

  if (inboxError) {
    console.error('[email/inbound/resend] failed to save inbox item', inboxError);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  if (contactId) {
    const { error: activityError } = await admin.from('contact_activities').insert({
      contact_id: contactId,
      type: 'email',
      note: `Inbound email: ${subject}${body ? `\n${body}` : ''}`,
      timestamp: occurredAt,
    });

    if (activityError) {
      console.warn('[email/inbound/resend] contact activity create failed', activityError);
    }
  }

  await forwardInboundEmail({
    salesperson,
    inboxItemId: String(inboxItem.id),
    routableAddresses,
    fromEmail,
    fromLabel,
    subject,
    body,
    preview,
    occurredAt,
  });

  await notifyWorkspaceMembers({
    admin,
    workspaceId,
    inboxItemId: String(inboxItem.id),
    fromLabel,
    subject,
    preview,
  });

  return NextResponse.json({ ok: true, inboxItemId: inboxItem.id });
}
