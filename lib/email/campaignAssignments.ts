import { Resend } from 'resend';

const DEFAULT_FROM_EMAIL = 'Daniel Phillippe <daniel@flyr.software>';
const DEFAULT_REPLY_TO = 'daniel@flyr.software';

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

export function getCampaignAssignmentMailerConfigError(): string | null {
  if (!getEnv('RESEND_API_KEY')) {
    return 'Campaign assignment email was not sent because RESEND_API_KEY is missing or empty.';
  }
  return null;
}

export type CampaignAssignmentEmailInput = {
  to: string;
  recipientName: string;
  campaignName: string;
  mode: 'zone_split' | 'whole_team';
  goalHomes: number;
  zoneIndex?: number | null;
  dueAt: string | null;
  notes: string | null;
  campaignUrl: string;
};

function buildText(input: CampaignAssignmentEmailInput): string {
  const zoneLabel = input.mode === 'zone_split' && input.zoneIndex ? `Zone ${input.zoneIndex}` : null;
  const modeLine =
    input.mode === 'zone_split'
      ? `You have been assigned ${zoneLabel ? `${zoneLabel} for this campaign.` : 'a campaign zone.'}`
      : 'Your team has been assigned this campaign together.';
  const lines = [
    `Hi ${input.recipientName || 'there'},`,
    '',
    modeLine,
    '',
    `Campaign: ${input.campaignName}`,
    ...(zoneLabel ? [`Assignment: ${zoneLabel}`] : []),
    `House goal: ${input.goalHomes}`,
  ];

  if (input.dueAt) lines.push(`Due: ${new Date(input.dueAt).toLocaleDateString('en-US')}`);
  if (input.notes) lines.push('', `Notes: ${input.notes}`);

  lines.push('', `Open campaign: ${input.campaignUrl}`, '', 'Daniel Phillippe', 'Founder');
  return lines.join('\n');
}

function buildHtml(input: CampaignAssignmentEmailInput): string {
  const zoneLabel = input.mode === 'zone_split' && input.zoneIndex ? `Zone ${input.zoneIndex}` : null;
  const modeLine =
    input.mode === 'zone_split'
      ? `You have been assigned ${zoneLabel ? `${zoneLabel} for this campaign.` : 'a campaign zone.'}`
      : 'Your team has been assigned this campaign together.';
  const due = input.dueAt ? new Date(input.dueAt).toLocaleDateString('en-US') : null;

  return `<!DOCTYPE html><html><body>
    <div style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.6;color:#1e293b;">
      <p style="margin:0 0 16px;">Hi ${escapeHtml(input.recipientName || 'there')},</p>
      <p style="margin:0 0 16px;">${escapeHtml(modeLine)}</p>
      <div style="margin:0 0 18px;padding:14px 16px;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;">
        <p style="margin:0 0 8px;"><strong>Campaign:</strong> ${escapeHtml(input.campaignName)}</p>
        ${zoneLabel ? `<p style="margin:0 0 8px;"><strong>Assignment:</strong> ${escapeHtml(zoneLabel)}</p>` : ''}
        <p style="margin:0 0 8px;"><strong>House goal:</strong> ${input.goalHomes}</p>
        ${due ? `<p style="margin:0;"><strong>Due:</strong> ${escapeHtml(due)}</p>` : ''}
      </div>
      ${input.notes ? `<p style="margin:0 0 18px;"><strong>Notes:</strong> ${escapeHtml(input.notes)}</p>` : ''}
      <p style="margin:0 0 22px;"><a href="${escapeHtml(input.campaignUrl)}" style="color:#0f172a;text-decoration:underline;">Open campaign</a></p>
      <p style="margin:0 0 4px;">Daniel Phillippe</p>
      <p style="margin:0;color:#64748b;font-size:14px;">Founder</p>
    </div>
  </body></html>`;
}

export async function sendCampaignAssignmentEmail(
  input: CampaignAssignmentEmailInput
): Promise<{ id: string | null }> {
  const apiKey = getEnv('RESEND_API_KEY');
  const configError = getCampaignAssignmentMailerConfigError();
  if (configError || !apiKey) {
    throw new Error(configError ?? 'Campaign assignment email is not configured.');
  }

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from: getEnv('RESEND_FROM_EMAIL') || DEFAULT_FROM_EMAIL,
    to: input.to,
    replyTo: DEFAULT_REPLY_TO,
    subject:
      input.mode === 'zone_split' && input.zoneIndex
        ? `Zone ${input.zoneIndex} assigned: ${input.campaignName}`
        : `Campaign assigned: ${input.campaignName}`,
    html: buildHtml(input),
    text: buildText(input),
  });

  if (error) {
    throw new Error(error.message.trim() || 'Resend email request failed');
  }

  return { id: typeof data?.id === 'string' ? data.id : null };
}
