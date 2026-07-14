import { Resend } from 'resend';

const DEFAULT_APP_ORIGIN = 'https://wolfgrid.app';
const PERSONAL_INBOX_DOMAINS = new Set([
  'aol.com',
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'icloud.com',
  'live.com',
  'mac.com',
  'me.com',
  'msn.com',
  'outlook.com',
  'proton.me',
  'protonmail.com',
  'yahoo.com',
]);

function getEnv(name: string): string | null {
  const value = process.env[name];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function stripWrappingQuotes(value: string): string {
  let next = value.trim();
  for (let index = 0; index < 3; index += 1) {
    const first = next[0];
    const last = next[next.length - 1];
    const wraps =
      (first === '"' && last === '"') ||
      (first === "'" && last === "'") ||
      (first === '`' && last === '`');
    if (!wraps) break;
    next = next.slice(1, -1).trim();
  }
  return next.replace(/\\"/g, '"').replace(/\\'/g, "'");
}

function normalizeEmailSender(value: string | null): string | null {
  if (!value) return null;
  const normalized = stripWrappingQuotes(value);
  return normalized || null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatExpiry(expiresAt: string): string {
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) {
    return 'in 7 days';
  }

  return date.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function extractEmailAddress(value: string | null): string | null {
  const trimmed = normalizeEmailSender(value);
  if (!trimmed) return null;

  const angleMatch = trimmed.match(/<([^>]+)>/);
  const candidate = (angleMatch?.[1] ?? trimmed).trim().toLowerCase();
  return candidate || null;
}

function getRawConfiguredInviteFrom(): string | null {
  return normalizeEmailSender(getEnv('RESEND_FROM_EMAIL')) || normalizeEmailSender(getEnv('INVITES_FROM_EMAIL'));
}

function getInviteFromEmailValidationError(): string | null {
  const from = getInviteFromEmail();
  const address = extractEmailAddress(from);

  if (!address) {
    return 'Invite was created, but email was not sent. Set RESEND_FROM_EMAIL to a sender on your verified domain (e.g. WolfGrid <noreply@yourdomain.com>).';
  }

  const domain = address.split('@')[1]?.trim().toLowerCase();
  if (!domain) {
    return 'Invite was created, but email was not sent because the sender address is invalid.';
  }

  if (PERSONAL_INBOX_DOMAINS.has(domain)) {
    return `Invite was created, but email was not sent. Resend cannot send from personal inboxes (${address}). Verify your domain at resend.com/domains, then set the sender to an address on that domain (for example WolfGrid <invites@yourdomain.com>).`;
  }

  return null;
}

export function getInviteMailerConfigError(): string | null {
  if (!getEnv('RESEND_API_KEY')) {
    return 'Invite was created, but email was not sent because the Resend API key is not configured on the server.';
  }

  return getInviteFromEmailValidationError();
}

export function getInviteFromEmail(): string | null {
  return getRawConfiguredInviteFrom();
}

export function getInviteReplyToEmail(): string | null {
  return getEnv('RESEND_REPLY_TO') || getEnv('INVITES_REPLY_TO');
}

export function getInviteAppOrigin(fallbackOrigin?: string): string {
  return (
    getEnv('APP_BASE_URL') ||
    getEnv('NEXT_PUBLIC_APP_URL') ||
    fallbackOrigin?.trim().replace(/\/$/, '') ||
    DEFAULT_APP_ORIGIN
  );
}

export type WorkspaceInviteEmailInput = {
  to: string;
  joinUrl: string;
  workspaceName: string;
  role: 'admin' | 'member';
  inviterEmail: string | null;
  expiresAt: string;
  previewText?: string | null;
  subjectPrefix?: string | null;
};

export type AmbassadorStripeOnboardingEmailInput = {
  to: string;
  fullName: string;
  onboardingUrl: string;
  referralCode: string | null;
};

export type SalespersonInviteEmailInput = {
  to: string;
  fullName: string;
  onboardingUrl: string;
  referralCode: string | null;
  commissionRateBps: number;
};

export type SalespersonMessengerEmailInput = {
  to: string;
  recipientName: string;
  senderName: string;
  preview: string;
  messageUrl: string;
  idempotencyKey?: string | null;
};

function getAmbassadorMailerConfigError(): string | null {
  if (!getEnv('RESEND_API_KEY')) {
    return 'Stripe onboarding link was created, but email was not sent because the Resend API key is not configured on the server.';
  }

  const from = getInviteFromEmail();
  const address = extractEmailAddress(from);
  if (!address) {
    return 'Stripe onboarding link was created, but email was not sent. Set RESEND_FROM_EMAIL to a sender on your verified domain.';
  }

  const domain = address.split('@')[1]?.trim().toLowerCase();
  if (!domain) {
    return 'Stripe onboarding link was created, but email was not sent because the sender address is invalid.';
  }

  if (PERSONAL_INBOX_DOMAINS.has(domain)) {
    return `Stripe onboarding link was created, but email was not sent. Resend cannot send from personal inboxes (${address}).`;
  }

  return null;
}

export async function sendAmbassadorStripeOnboardingEmail(
  input: AmbassadorStripeOnboardingEmailInput
): Promise<{ id: string | null }> {
  const apiKey = getEnv('RESEND_API_KEY');
  const from = getInviteFromEmail();
  const configError = getAmbassadorMailerConfigError();

  if (configError || !apiKey || !from) {
    throw new Error(configError ?? 'Ambassador onboarding email is not configured.');
  }

  const firstName = input.fullName.trim().split(/\s+/)[0] || 'there';
  const escapedFirstName = escapeHtml(firstName);
  const escapedOnboardingUrl = escapeHtml(input.onboardingUrl);
  const referralLine = input.referralCode
    ? `Your ambassador referral code is ${input.referralCode}.`
    : 'Your ambassador referral code will be shared separately.';
  const text = [
    'Complete your WolfGrid ambassador payout setup',
    '',
    `Hi ${firstName},`,
    '',
    'Your WolfGrid ambassador application has been approved.',
    'Please complete Stripe onboarding so Stripe can securely collect your payout and identity details.',
    referralLine,
    '',
    `Complete Stripe onboarding: ${input.onboardingUrl}`,
    '',
    'This link may expire after it is opened. If it stops working, reply and we will send a fresh one.',
  ].join('\n');

  const html = `
    <div style="margin:0;padding:32px 18px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;">
      <div style="max-width:580px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
        <div style="padding:28px 30px 18px;border-bottom:1px solid #e2e8f0;">
          <div style="font-size:28px;line-height:1;font-weight:800;color:#111827;">WolfGrid</div>
          <h1 style="margin:14px 0 0;font-size:24px;line-height:1.25;color:#111827;font-weight:700;">Ambassador payout setup</h1>
        </div>
        <div style="padding:28px 30px;">
          <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#334155;">Hi ${escapedFirstName},</p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#334155;">Your WolfGrid ambassador application has been approved.</p>
          <p style="margin:0 0 22px;font-size:15px;line-height:1.65;color:#334155;">Please complete Stripe onboarding so Stripe can securely collect your payout and identity details.</p>
          <p style="margin:0 0 24px;">
            <a href="${escapedOnboardingUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:13px 20px;border-radius:10px;font-size:15px;font-weight:700;">
              Complete Stripe onboarding
            </a>
          </p>
          <p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#64748b;">${escapeHtml(referralLine)}</p>
          <p style="margin:0;font-size:12px;line-height:1.6;color:#64748b;word-break:break-all;">
            If the button does not work, use this link: <a href="${escapedOnboardingUrl}" style="color:#334155;text-decoration:underline;">${escapedOnboardingUrl}</a>
          </p>
        </div>
      </div>
    </div>
  `.trim();

  const resend = new Resend(apiKey);
  const replyTo = getInviteReplyToEmail();
  const { data, error } = await resend.emails.send({
    from,
    to: input.to,
    subject: 'Complete your WolfGrid ambassador payout setup',
    html,
    text,
    ...(replyTo ? { replyTo } : {}),
  });

  if (error) {
    const message = error.message.trim() || 'Resend email request failed';
    if (/only send testing emails|verify a domain at resend\.com\/domains/i.test(message)) {
      throw new Error(
        'Stripe onboarding link was created, but email was not sent. Resend test mode only delivers to your account email.'
      );
    }

    if (error.statusCode === 403) {
      throw new Error(
        message
          ? `${message} Use a sender address on a domain you have verified in Resend.`
          : 'Resend rejected the ambassador onboarding email. Use a sender on a verified domain in Resend.'
      );
    }

    throw new Error(message);
  }

  return {
    id: typeof data?.id === 'string' ? data.id : null,
  };
}

export async function sendSalespersonInviteEmail(
  input: SalespersonInviteEmailInput
): Promise<{ id: string | null }> {
  const apiKey = getEnv('RESEND_API_KEY');
  const from = getInviteFromEmail();
  const configError = getInviteMailerConfigError();

  if (configError || !apiKey || !from) {
    throw new Error(configError ?? 'Salesperson invite email is not configured.');
  }

  const firstName = input.fullName.trim().split(/\s+/)[0] || 'there';
  const escapedFirstName = escapeHtml(firstName);
  const escapedOnboardingUrl = escapeHtml(input.onboardingUrl);
  const commissionLabel = `${(input.commissionRateBps / 100).toFixed(
    input.commissionRateBps % 100 === 0 ? 0 : 2
  )}%`;
  const referralLine = input.referralCode
    ? `Your referral code is ${input.referralCode}.`
    : 'Your referral code will be generated after setup.';

  const text = [
    'You have been invited to sell with WolfGrid',
    '',
    `Hi ${firstName},`,
    '',
    'You have been invited to join the WolfGrid sales program.',
    `${referralLine} Your commission rate is ${commissionLabel}.`,
    '',
    `Complete setup: ${input.onboardingUrl}`,
    '',
    'Use the same email address this invite was sent to when you create or sign into your account.',
  ].join('\n');

  const html = `
    <div style="margin:0;padding:32px 18px;background:#06090f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e5e7eb;">
      <div style="max-width:580px;margin:0 auto;background:#11151f;border:1px solid #222938;border-radius:18px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.45);">
        <div style="padding:30px 30px 22px;border-bottom:1px solid #222938;background:linear-gradient(180deg,#161c29 0%,#11151f 100%);">
          <div style="font-size:30px;line-height:1;font-weight:800;letter-spacing:.02em;color:#ffffff;">WolfGrid</div>
          <h1 style="margin:12px 0 0;font-size:28px;line-height:1.2;color:#f9fafb;font-weight:700;">Salesperson setup</h1>
        </div>
        <div style="padding:30px;">
          <p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:#c6cfdf;">Hi ${escapedFirstName},</p>
          <p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:#c6cfdf;">You have been invited to join the WolfGrid sales program.</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.65;color:#aab4c6;">${escapeHtml(referralLine)} Your commission rate is ${escapeHtml(commissionLabel)}.</p>
          <p style="margin:0 0 24px;">
            <a href="${escapedOnboardingUrl}" style="display:inline-block;background:#ef4444;color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:11px;font-size:15px;font-weight:700;letter-spacing:.01em;">
              Complete setup
            </a>
          </p>
          <p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#8f9bb1;">Use the same email address this invite was sent to when you create or sign into your account.</p>
          <p style="margin:0;font-size:12px;line-height:1.6;word-break:break-all;">
            <a href="${escapedOnboardingUrl}" style="color:#7084a8;text-decoration:underline;">${escapedOnboardingUrl}</a>
          </p>
        </div>
      </div>
    </div>
  `.trim();

  const resend = new Resend(apiKey);
  const replyTo = getInviteReplyToEmail();
  const { data, error } = await resend.emails.send({
    from,
    to: input.to,
    subject: 'You have been invited to sell with WolfGrid',
    html,
    text,
    ...(replyTo ? { replyTo } : {}),
  });

  if (error) {
    const message = error.message.trim() || 'Resend email request failed';
    if (/only send testing emails|verify a domain at resend\.com\/domains/i.test(message)) {
      throw new Error(
        'Salesperson invite was created, but email was not sent to this address. Resend test mode only delivers to your account email.'
      );
    }

    if (error.statusCode === 403) {
      throw new Error(
        message
          ? `${message} Use a sender address on a domain you have verified in Resend.`
          : 'Resend rejected the salesperson invite email. Use a sender on a verified domain in Resend.'
      );
    }

    throw new Error(message);
  }

  return {
    id: typeof data?.id === 'string' ? data.id : null,
  };
}

function getSalespersonMessengerMailerConfigError(): string | null {
  if (!getEnv('RESEND_API_KEY')) {
    return 'Sales Floor email notification was not sent because the Resend API key is not configured on the server.';
  }

  const from = getInviteFromEmail();
  const address = extractEmailAddress(from);
  if (!address) {
    return 'Sales Floor email notification was not sent because RESEND_FROM_EMAIL is not configured.';
  }

  const domain = address.split('@')[1]?.trim().toLowerCase();
  if (!domain) {
    return 'Sales Floor email notification was not sent because the sender address is invalid.';
  }

  if (PERSONAL_INBOX_DOMAINS.has(domain)) {
    return `Sales Floor email notification was not sent. Resend cannot send from personal inboxes (${address}).`;
  }

  return null;
}

export async function sendSalespersonMessengerEmail(
  input: SalespersonMessengerEmailInput
): Promise<{ id: string | null }> {
  const apiKey = getEnv('RESEND_API_KEY');
  const from = getInviteFromEmail();
  const configError = getSalespersonMessengerMailerConfigError();

  if (configError || !apiKey || !from) {
    throw new Error(configError ?? 'Sales Floor email notification is not configured.');
  }

  const recipientFirstName = input.recipientName.trim().split(/\s+/)[0] || 'there';
  const senderName = input.senderName.trim() || 'Sales Floor';
  const preview = input.preview.trim() || 'New message';
  const escapedRecipientFirstName = escapeHtml(recipientFirstName);
  const escapedSenderName = escapeHtml(senderName);
  const escapedPreview = escapeHtml(preview);
  const escapedMessageUrl = escapeHtml(input.messageUrl);

  const text = [
    `New Sales Floor message from ${senderName}`,
    '',
    `Hi ${recipientFirstName},`,
    '',
    `${senderName} posted in Sales Floor:`,
    preview,
    '',
    `Open Sales Floor: ${input.messageUrl}`,
  ].join('\n');

  const html = `
    <div style="margin:0;padding:32px 18px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;">
      <div style="max-width:580px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
        <div style="padding:28px 30px 18px;border-bottom:1px solid #e2e8f0;">
          <div style="font-size:28px;line-height:1;font-weight:800;color:#111827;">WolfGrid</div>
          <h1 style="margin:14px 0 0;font-size:24px;line-height:1.25;color:#111827;font-weight:700;">New Sales Floor message</h1>
        </div>
        <div style="padding:28px 30px;">
          <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#334155;">Hi ${escapedRecipientFirstName},</p>
          <p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#334155;"><strong style="color:#111827;">${escapedSenderName}</strong> posted in Sales Floor.</p>
          <div style="margin:0 0 24px;padding:14px 16px;border-radius:12px;background:#f1f5f9;border:1px solid #e2e8f0;color:#334155;font-size:15px;line-height:1.55;">
            ${escapedPreview}
          </div>
          <p style="margin:0 0 24px;">
            <a href="${escapedMessageUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:13px 20px;border-radius:10px;font-size:15px;font-weight:700;">
              Open Sales Floor
            </a>
          </p>
          <p style="margin:0;font-size:12px;line-height:1.6;color:#64748b;">You will not receive another Sales Floor email for this conversation for about 2 hours.</p>
        </div>
      </div>
    </div>
  `.trim();

  const resend = new Resend(apiKey);
  const replyTo = getInviteReplyToEmail();
  const options = input.idempotencyKey
    ? { headers: { 'Idempotency-Key': input.idempotencyKey } }
    : undefined;
  const { data, error } = await resend.emails.send(
    {
      from,
      to: input.to,
      subject: `New Sales Floor message from ${senderName}`,
      html,
      text,
      ...(replyTo ? { replyTo } : {}),
    },
    options
  );

  if (error) {
    const message = error.message.trim() || 'Resend email request failed';
    if (/only send testing emails|verify a domain at resend\.com\/domains/i.test(message)) {
      throw new Error(
        'Sales Floor email notification was not sent. Resend test mode only delivers to your account email.'
      );
    }

    if (error.statusCode === 403) {
      throw new Error(
        message
          ? `${message} Use a sender address on a domain you have verified in Resend.`
          : 'Resend rejected the Sales Floor email notification. Use a sender on a verified domain in Resend.'
      );
    }

    throw new Error(message);
  }

  return {
    id: typeof data?.id === 'string' ? data.id : null,
  };
}

export async function sendWorkspaceInviteEmail(input: WorkspaceInviteEmailInput): Promise<{ id: string | null }> {
  const apiKey = getEnv('RESEND_API_KEY');
  const from = getInviteFromEmail();
  const configError = getInviteMailerConfigError();

  if (configError || !apiKey || !from) {
    throw new Error(configError ?? 'Invite email is not configured.');
  }

  const workspaceName = input.workspaceName.trim() || 'your workspace';
  const escapedWorkspaceName = escapeHtml(workspaceName);
  const escapedJoinUrl = escapeHtml(input.joinUrl);
  const inviterLine = input.inviterEmail
    ? `${escapeHtml(input.inviterEmail)} invited you`
    : 'You were invited';
  const expiresLabel = formatExpiry(input.expiresAt);
  const roleLabel = input.role === 'admin' ? 'admin' : 'member';
  const previewText = input.previewText?.trim() || '';
  const text = [
    `${input.subjectPrefix?.trim() ? `${input.subjectPrefix.trim()} ` : ''}Join ${workspaceName} on WolfGrid`,
    '',
    ...(previewText ? [previewText, ''] : []),
    `${input.inviterEmail ?? 'Someone on your team'} invited you to join ${workspaceName} as a ${roleLabel}.`,
    'Use the same email address this invite was sent to when you sign in or create your account.',
    '',
    `Accept invite: ${input.joinUrl}`,
    `This invite expires ${expiresLabel}.`,
  ].join('\n');

  const html = `
    <div style="margin:0;padding:32px 18px;background:#06090f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e5e7eb;">
      <div style="max-width:580px;margin:0 auto;background:#11151f;border:1px solid #222938;border-radius:18px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.45);">
        <div style="padding:30px 30px 22px;border-bottom:1px solid #222938;background:linear-gradient(180deg,#161c29 0%,#11151f 100%);">
          <div style="font-size:30px;line-height:1;font-weight:800;letter-spacing:.02em;color:#ffffff;">WolfGrid</div>
          <h1 style="margin:12px 0 0;font-size:28px;line-height:1.2;color:#f9fafb;font-weight:700;">Join ${escapedWorkspaceName}</h1>
        </div>
        <div style="padding:30px;">
          ${previewText
            ? `<p style="margin:0 0 18px;font-size:13px;line-height:1.6;color:#fecaca;background:#341819;border:1px solid #5e2427;border-radius:10px;padding:12px 14px;">${escapeHtml(previewText)}</p>`
            : ''}
          <p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:#c6cfdf;">
            ${inviterLine} to join <strong style="color:#ffffff;">${escapedWorkspaceName}</strong> on WolfGrid as a ${roleLabel}.
          </p>
          <p style="margin:0 0 26px;font-size:15px;line-height:1.65;color:#aab4c6;">
            Use the same email address this invite was sent to when you sign in or create your account.
          </p>
          <p style="margin:0 0 24px;">
            <a href="${escapedJoinUrl}" style="display:inline-block;background:#e5e7eb;color:#0b0f17;text-decoration:none;padding:13px 22px;border-radius:11px;font-size:15px;font-weight:700;letter-spacing:.01em;">
              Accept invite
            </a>
          </p>
          <div style="margin:0 0 16px;padding:12px 14px;border-radius:10px;background:#0c111b;border:1px solid #1d2533;">
            <p style="margin:0;font-size:13px;line-height:1.6;color:#8f9bb1;">
              This invite expires ${escapeHtml(expiresLabel)}.
            </p>
          </div>
          <p style="margin:0;font-size:12px;line-height:1.6;word-break:break-all;">
            <a href="${escapedJoinUrl}" style="color:#7084a8;text-decoration:underline;">${escapedJoinUrl}</a>
          </p>
        </div>
      </div>
    </div>
  `.trim();

  const resend = new Resend(apiKey);
  const replyTo = getInviteReplyToEmail();
  const subject = `${input.subjectPrefix?.trim() ? `${input.subjectPrefix.trim()} ` : ''}You're invited to join ${workspaceName} on WolfGrid`;

  const { data, error } = await resend.emails.send({
    from,
    to: input.to,
    subject,
    html,
    text,
    ...(replyTo ? { replyTo } : {}),
  });

  if (error) {
    const message =
      error.message.trim() || 'Resend email request failed';

    if (
      /only send testing emails|verify a domain at resend\.com\/domains/i.test(
        message
      )
    ) {
      throw new Error(
        'Invite was created, but email was not sent to this address. Resend test mode only delivers to your account email. Set RESEND_FROM_EMAIL to a sender on your verified domain (e.g. WolfGrid <noreply@yourdomain.com>).'
      );
    }

    if (error.statusCode === 403) {
      throw new Error(
        message
          ? `${message} Use a sender address on a domain you have verified in Resend.`
          : 'Resend rejected the invite email. Use a sender on a verified domain in Resend.'
      );
    }

    throw new Error(message);
  }

  return {
    id: typeof data?.id === 'string' ? data.id : null,
  };
}
