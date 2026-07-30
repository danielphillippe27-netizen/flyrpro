import { Resend } from 'resend';
import { resolvePublicAppOrigin } from '@/lib/auth/public-origin';

const DEFAULT_FROM_EMAIL = 'Daniel Phillippe <daniel@wolfgrid.app>';
const DEFAULT_NOTIFICATION_EMAIL = 'daniel@wolfgrid.app';

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

function singleLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export type FeedbackNotificationEmailInput = {
  message: string;
  submitterEmail: string | null;
  submitterUserId: string;
  workspaceId: string;
  role: string | null;
  page: string | null;
  threadId: string;
  requestOrigin?: string;
};

export type FeedbackNotificationEmailContent = {
  subject: string;
  html: string;
  text: string;
  adminUrl: string;
};

export function buildFeedbackNotificationEmail(
  input: FeedbackNotificationEmailInput
): FeedbackNotificationEmailContent {
  const submitter = input.submitterEmail
    ? singleLine(input.submitterEmail)
    : `User ${input.submitterUserId}`;
  const adminUrl = new URL('/admin/feedback', resolvePublicAppOrigin(input.requestOrigin));
  adminUrl.searchParams.set('thread', input.threadId);

  const details = [
    ['From', submitter],
    ['Workspace', input.workspaceId],
    ['Role', input.role || 'Unknown'],
    ['Submitted from', input.page || 'Unknown'],
  ] as const;

  const detailRows = details
    .map(
      ([label, value]) =>
        `<tr><td style="padding:3px 12px 3px 0;color:#64748b;vertical-align:top;white-space:nowrap;">${escapeHtml(label)}</td><td style="padding:3px 0;color:#1e293b;word-break:break-word;">${escapeHtml(value)}</td></tr>`
    )
    .join('');

  const html = `<!DOCTYPE html><html><body>
    <div style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.6;color:#1e293b;">
      <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">New WolfGrid feedback</h1>
      <table role="presentation" style="margin:0 0 18px;border-collapse:collapse;">${detailRows}</table>
      <div style="margin:0 0 20px;padding:14px 16px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;white-space:pre-wrap;">${escapeHtml(input.message)}</div>
      <p style="margin:0;"><a href="${escapeHtml(adminUrl.toString())}" style="display:inline-block;padding:10px 16px;border-radius:8px;background:#111827;color:#ffffff;text-decoration:none;font-weight:700;">Open feedback inbox</a></p>
    </div>
  </body></html>`;

  const text = [
    'New WolfGrid feedback',
    '',
    ...details.map(([label, value]) => `${label}: ${value}`),
    '',
    input.message,
    '',
    `Open feedback inbox: ${adminUrl.toString()}`,
  ].join('\n');

  return {
    subject: `New WolfGrid feedback from ${submitter}`,
    html,
    text,
    adminUrl: adminUrl.toString(),
  };
}

export async function sendFeedbackNotificationEmail(
  input: FeedbackNotificationEmailInput
): Promise<{ id: string | null; skipped: boolean }> {
  const apiKey = getEnv('RESEND_API_KEY');
  if (!apiKey) return { id: null, skipped: true };

  const content = buildFeedbackNotificationEmail(input);
  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from: getEnv('RESEND_FROM_EMAIL') || DEFAULT_FROM_EMAIL,
    to: getEnv('FEEDBACK_NOTIFICATION_EMAIL') || DEFAULT_NOTIFICATION_EMAIL,
    replyTo: input.submitterEmail || getEnv('RESEND_REPLY_TO') || DEFAULT_NOTIFICATION_EMAIL,
    subject: content.subject,
    html: content.html,
    text: content.text,
  });

  if (error) {
    throw new Error(error.message.trim() || 'Resend feedback notification request failed');
  }

  return {
    id: typeof data?.id === 'string' ? data.id : null,
    skipped: false,
  };
}
