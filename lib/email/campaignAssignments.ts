import { Resend } from 'resend';

const DEFAULT_FROM_EMAIL = 'WolfGrid Notifications <notification@wolfgrid.app>';
const DEFAULT_REPLY_TO = 'notification@wolfgrid.app';

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

export function getCampaignAssignmentMailerConfigError(): string | null {
  if (!getEnv('RESEND_API_KEY')) {
    return 'Campaign assignment email was not sent because RESEND_API_KEY is missing or empty.';
  }
  return null;
}

export type CampaignAssignmentEmailInput = {
  to: string;
  recipientName: string;
  teamLeaderName: string | null;
  teamLeaderEmail: string | null;
  campaignName: string;
  mode: 'zone_split' | 'whole_team';
  goalHomes: number;
  zoneIndex?: number | null;
  dueAt: string | null;
  notes: string | null;
  campaignUrl: string;
};

export type CampaignAssignmentEmailContent = {
  from: string;
  replyTo: string;
  subject: string;
  html: string;
  text: string;
};

function normalizeSingleLine(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/[\r\n]+/g, ' ').trim();
  return normalized || null;
}

export function resolveCampaignAssignmentTeamLeaderName(input: {
  firstName?: string | null;
  lastName?: string | null;
  metadataFullName?: string | null;
  metadataName?: string | null;
}): string {
  const profileName = [input.firstName, input.lastName]
    .map(normalizeSingleLine)
    .filter((part): part is string => Boolean(part))
    .join(' ');
  return (
    profileName ||
    normalizeSingleLine(input.metadataFullName) ||
    normalizeSingleLine(input.metadataName) ||
    'WolfGrid Team'
  );
}

function getTeamLeaderName(input: CampaignAssignmentEmailInput): string {
  return normalizeSingleLine(input.teamLeaderName) || 'WolfGrid Team';
}

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

  lines.push('', `Review assignment: ${input.campaignUrl}`, '', getTeamLeaderName(input), 'Team Leader');
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
      <p style="margin:0 0 22px;"><a href="${escapeHtml(input.campaignUrl)}" style="display:inline-block;padding:11px 18px;border-radius:8px;background:#dc2626;color:#ffffff;text-decoration:none;font-weight:700;">Review assignment</a></p>
      <p style="margin:0 0 4px;">${escapeHtml(getTeamLeaderName(input))}</p>
      <p style="margin:0;color:#64748b;font-size:14px;">Team Leader</p>
    </div>
  </body></html>`;
}

export function buildCampaignAssignmentEmail(
  input: CampaignAssignmentEmailInput
): CampaignAssignmentEmailContent {
  return {
    from:
      normalizeEmailSender(getEnv('CAMPAIGN_ASSIGNMENT_FROM_EMAIL')) ||
      DEFAULT_FROM_EMAIL,
    replyTo:
      normalizeSingleLine(input.teamLeaderEmail) ||
      normalizeSingleLine(getEnv('RESEND_REPLY_TO')) ||
      DEFAULT_REPLY_TO,
    subject:
      input.mode === 'zone_split' && input.zoneIndex
        ? `Zone ${input.zoneIndex} assigned: ${input.campaignName}`
        : `Campaign assigned: ${input.campaignName}`,
    html: buildHtml(input),
    text: buildText(input),
  };
}

export async function sendCampaignAssignmentEmail(
  input: CampaignAssignmentEmailInput
): Promise<{ id: string | null }> {
  const apiKey = getEnv('RESEND_API_KEY');
  const configError = getCampaignAssignmentMailerConfigError();
  if (configError || !apiKey) {
    throw new Error(configError ?? 'Campaign assignment email is not configured.');
  }

  const content = buildCampaignAssignmentEmail(input);
  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from: content.from,
    to: input.to,
    replyTo: content.replyTo,
    subject: content.subject,
    html: content.html,
    text: content.text,
  });

  if (error) {
    throw new Error(error.message.trim() || 'Resend email request failed');
  }

  return { id: typeof data?.id === 'string' ? data.id : null };
}
