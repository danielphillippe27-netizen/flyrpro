import { Resend } from 'resend';

const DEFAULT_APP_ORIGIN = 'https://flyrpro.app';
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
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const angleMatch = trimmed.match(/<([^>]+)>/);
  const candidate = (angleMatch?.[1] ?? trimmed).trim().toLowerCase();
  return candidate || null;
}

function getRawConfiguredInviteFrom(): string | null {
  return getEnv('RESEND_FROM_EMAIL') || getEnv('INVITES_FROM_EMAIL');
}

function getInviteFromEmailValidationError(): string | null {
  const from = getInviteFromEmail();
  const address = extractEmailAddress(from);

  if (!address) {
    return 'Invite was created, but email was not sent. Set RESEND_FROM_EMAIL to a sender on your verified domain (e.g. FLYR <noreply@yourdomain.com>).';
  }

  const domain = address.split('@')[1]?.trim().toLowerCase();
  if (!domain) {
    return 'Invite was created, but email was not sent because the sender address is invalid.';
  }

  if (PERSONAL_INBOX_DOMAINS.has(domain)) {
    return `Invite was created, but email was not sent. Resend cannot send from personal inboxes (${address}). Verify your domain at resend.com/domains, then set the sender to an address on that domain (for example FLYR <invites@yourdomain.com>).`;
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
    getEnv('NEXT_PUBLIC_APP_URL') ||
    getEnv('APP_BASE_URL') ||
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
    `${input.subjectPrefix?.trim() ? `${input.subjectPrefix.trim()} ` : ''}Join ${workspaceName} on FLYR`,
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
          <div style="font-size:30px;line-height:1;font-weight:800;letter-spacing:.02em;color:#ffffff;">FLYR</div>
          <h1 style="margin:12px 0 0;font-size:28px;line-height:1.2;color:#f9fafb;font-weight:700;">Join ${escapedWorkspaceName}</h1>
        </div>
        <div style="padding:30px;">
          ${previewText
            ? `<p style="margin:0 0 18px;font-size:13px;line-height:1.6;color:#fecaca;background:#341819;border:1px solid #5e2427;border-radius:10px;padding:12px 14px;">${escapeHtml(previewText)}</p>`
            : ''}
          <p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:#c6cfdf;">
            ${inviterLine} to join <strong style="color:#ffffff;">${escapedWorkspaceName}</strong> on FLYR as a ${roleLabel}.
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
  const subject = `${input.subjectPrefix?.trim() ? `${input.subjectPrefix.trim()} ` : ''}You're invited to join ${workspaceName} on FLYR`;

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
        'Invite was created, but email was not sent to this address. Resend test mode only delivers to your account email. Set RESEND_FROM_EMAIL to a sender on your verified domain (e.g. FLYR <noreply@yourdomain.com>).'
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
