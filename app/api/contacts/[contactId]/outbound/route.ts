import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { resolveWorkspaceMembershipForUser, type MinimalSupabaseClient } from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';
import { getWorkspaceDialerSettings } from '@/lib/dialer/server';
import { sendDialerSms } from '@/lib/dialer/provider';
import { normalizePhoneNumber, phoneMarketFromCountryCode } from '@/lib/dialer/phone';
import { getSalespersonDialerSettingsForUser } from '@/lib/dialer/salesperson-settings';
import { resolveOutboundCallerId } from '@/lib/dialer/caller-id';
import type { Contact, DialerSmsFollowup } from '@/types/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type OutboundPayload = {
  workspaceId?: string | null;
  channel?: 'text' | 'email';
  body?: string;
  subject?: string;
};

const MAX_SMS_BODY_LENGTH = 1000;
const MAX_EMAIL_BODY_LENGTH = 20000;

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

async function loadAuthorizedContact(
  request: NextRequest,
  contactId: string,
  requestedWorkspaceId?: string | null
): Promise<
  | NextResponse
  | {
      admin: ReturnType<typeof createAdminClient>;
      contact: Contact;
      requestUser: { id: string; email: string | null };
      workspaceId: string;
    }
> {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const membership = await resolveWorkspaceMembershipForUser(
    admin as unknown as MinimalSupabaseClient,
    requestUser.id,
    requestedWorkspaceId ?? undefined
  );

  if (!membership.workspaceId) {
    return NextResponse.json(
      { error: membership.error ?? 'Workspace not found' },
      { status: membership.status ?? 403 }
    );
  }

  const { data, error } = await admin
    .from('contacts')
    .select('*')
    .eq('id', contactId)
    .eq('workspace_id', membership.workspaceId)
    .maybeSingle();

  if (error) {
    console.error('[contacts/outbound] failed to load contact', error);
    return NextResponse.json({ error: 'Failed to load contact' }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  return {
    admin,
    contact: data as Contact,
    requestUser,
    workspaceId: membership.workspaceId,
  };
}

async function sendText(
  request: NextRequest,
  auth: Exclude<Awaited<ReturnType<typeof loadAuthorizedContact>>, NextResponse>,
  body: string
) {
  if (body.length > MAX_SMS_BODY_LENGTH) {
    return NextResponse.json(
      { error: `Keep the text under ${MAX_SMS_BODY_LENGTH} characters.` },
      { status: 400 }
    );
  }

  const salespersonContext = await getSalespersonDialerSettingsForUser(auth.admin, {
    userId: auth.requestUser.id,
    email: auth.requestUser.email,
    workspaceId: auth.workspaceId,
  });
  const settings = await getWorkspaceDialerSettings(
    auth.admin,
    auth.workspaceId,
    salespersonContext.settings
  );
  if (!settings.defaultSmsFromNumber) {
    return NextResponse.json(
      { error: 'Add an SMS-enabled dialer number before sending texts.' },
      { status: 400 }
    );
  }

  const normalizedPhone = normalizePhoneNumber(
    auth.contact.phone_e164 ?? auth.contact.phone,
    phoneMarketFromCountryCode(auth.contact.phone_country_code)
  );
  if (!normalizedPhone.e164) {
    return NextResponse.json({ error: 'This lead does not have a valid SMS number.' }, { status: 400 });
  }

  try {
    const now = new Date().toISOString();
    const fromNumber = resolveOutboundCallerId({
      toNumber: normalizedPhone.e164,
      defaultFromNumber: settings.defaultSmsFromNumber,
    });
    const message = await sendDialerSms(request, {
      from: fromNumber,
      to: normalizedPhone.e164,
      body,
    });

    const insertPayload = {
      workspace_id: auth.workspaceId,
      call_id: null,
      contact_id: auth.contact.id,
      user_id: auth.requestUser.id,
      telecom_provider: message.provider,
      provider_message_id: message.messageId,
      twilio_message_sid: message.provider === 'twilio' ? message.messageId : null,
      from_number_e164: fromNumber,
      to_number_e164: normalizedPhone.e164,
      body,
      status: message.status,
      sent_at: now,
      status_payload: {
        ...message.raw,
        provider: message.provider,
        source: 'contact_record',
      },
    };

    const [{ data: followup, error: insertError }, { error: activityError }, { error: contactError }] = await Promise.all([
      auth.admin.from('dialer_sms_followups').insert(insertPayload).select('*').single(),
      auth.admin.from('contact_activities').insert({
        contact_id: auth.contact.id,
        type: 'text',
        note: `Outbound SMS: ${body}`,
        timestamp: now,
      }),
      auth.admin.from('contacts').update({ last_contacted: now, updated_at: now }).eq('id', auth.contact.id),
    ]);

    if (activityError) {
      console.warn('[contacts/outbound] failed to log text activity', activityError);
    }

    if (contactError) {
      console.warn('[contacts/outbound] failed to update contact after text', contactError);
    }

    if (insertError) {
      console.error('[contacts/outbound] failed to save text follow-up', insertError);
      return NextResponse.json(
        { sent: true, warning: 'Text sent, but FLYR could not save the text record.' },
        { status: 201 }
      );
    }

    return NextResponse.json({ sent: true, followup: followup as DialerSmsFollowup }, { status: 201 });
  } catch (error) {
    console.error('[contacts/outbound] failed to send text', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send the text.' },
      { status: 500 }
    );
  }
}

async function sendEmail(
  auth: Exclude<Awaited<ReturnType<typeof loadAuthorizedContact>>, NextResponse>,
  subject: string,
  body: string
) {
  if (body.length > MAX_EMAIL_BODY_LENGTH) {
    return NextResponse.json(
      { error: `Keep the email under ${MAX_EMAIL_BODY_LENGTH} characters.` },
      { status: 400 }
    );
  }

  const recipient = cleanText(auth.contact.email);
  if (!recipient) {
    return NextResponse.json({ error: 'This lead does not have an email address.' }, { status: 400 });
  }

  const apiKey = getEnv('RESEND_API_KEY');
  const from = getEnv('RESEND_FROM_EMAIL') || getEnv('INVITES_FROM_EMAIL');
  if (!apiKey || !from) {
    return NextResponse.json(
      { error: 'Email is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.' },
      { status: 400 }
    );
  }

  try {
    const resend = new Resend(apiKey);
    const now = new Date().toISOString();
    const emailSubject = cleanText(subject) || 'Following up';
    const escapedBody = escapeHtml(body).replace(/\n/g, '<br />');
    const replyTo = getEnv('RESEND_REPLY_TO');
    const { data, error } = await resend.emails.send({
      from,
      to: recipient,
      subject: emailSubject,
      text: body,
      html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.6;color:#111827;">${escapedBody}</div>`,
      ...(replyTo ? { replyTo } : {}),
    });

    if (error) {
      const message = error.message?.trim() || 'Failed to send the email.';
      return NextResponse.json({ error: message }, { status: error.statusCode ?? 500 });
    }

    const [{ error: activityError }, { error: contactError }] = await Promise.all([
      auth.admin.from('contact_activities').insert({
        contact_id: auth.contact.id,
        type: 'email',
        note: `Outbound email: ${emailSubject}\n${body}`,
        timestamp: now,
      }),
      auth.admin.from('contacts').update({ last_contacted: now, updated_at: now }).eq('id', auth.contact.id),
    ]);

    if (activityError) {
      console.warn('[contacts/outbound] failed to log email activity', activityError);
    }

    if (contactError) {
      console.warn('[contacts/outbound] failed to update contact after email', contactError);
    }

    return NextResponse.json({ sent: true, emailId: typeof data?.id === 'string' ? data.id : null }, { status: 201 });
  } catch (error) {
    console.error('[contacts/outbound] failed to send email', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send the email.' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ contactId: string }> }
) {
  const payload = (await request.json().catch(() => ({}))) as OutboundPayload;
  const body = cleanText(payload.body);
  const channel = payload.channel;
  const { contactId } = await params;

  if (channel !== 'text' && channel !== 'email') {
    return NextResponse.json({ error: 'Choose text or email before sending.' }, { status: 400 });
  }

  if (!body) {
    return NextResponse.json({ error: channel === 'email' ? 'Write an email before sending it.' : 'Write a text before sending it.' }, { status: 400 });
  }

  const auth = await loadAuthorizedContact(request, contactId, payload.workspaceId);
  if (auth instanceof NextResponse) return auth;

  return channel === 'email'
    ? sendEmail(auth, cleanText(payload.subject), body)
    : sendText(request, auth, body);
}
