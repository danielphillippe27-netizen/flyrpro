import { Resend } from 'resend';

const DEFAULT_FROM_EMAIL = 'Daniel Phillippe <daniel@flyr.software>';
const DEFAULT_REPLY_TO = 'daniel@flyr.software';

export type TeamReportPeriod = 'weekly' | 'monthly' | 'yearly';

export type TeamReportMetricKey =
  | 'doors_knocked'
  | 'flyers_delivered'
  | 'conversations'
  | 'leads_created'
  | 'appointments_set'
  | 'time_spent_seconds'
  | 'sessions_count';

export type TeamReportMetrics = Record<TeamReportMetricKey, number>;

export type TeamReportDelta = {
  abs: number;
  pct: number | null;
  trend: 'up' | 'down' | 'flat';
};

export type TeamReportMember = {
  display_name: string;
  role: string;
  has_report: boolean;
  metrics: TeamReportMetrics;
  rates: {
    conversations_per_door: number;
    leads_per_conversation: number;
    appointments_per_conversation: number;
  };
};

export type TeamLeadReportEmailInput = {
  to: string[];
  workspaceName: string;
  period: TeamReportPeriod;
  periodStart: string;
  periodEnd: string;
  generatedAt: string | null;
  totals: TeamReportMetrics;
  deltas: Record<TeamReportMetricKey, TeamReportDelta>;
  rates: {
    conversations_per_door: number;
    leads_per_conversation: number;
    appointments_per_conversation: number;
  };
  members: TeamReportMember[];
  dashboardUrl: string;
};

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

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(Math.round(value));
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0%';
  return `${Math.round(value * 100)}%`;
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function formatDateRange(start: string, end: string): string {
  const startDate = new Date(start);
  const endDate = new Date(new Date(end).getTime() - 1);
  return `${startDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })} - ${endDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })}`;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function deltaLabel(delta: TeamReportDelta): string {
  const prefix = delta.abs >= 0 ? '+' : '';
  if (delta.pct == null) return `${prefix}${formatNumber(delta.abs)}`;
  return `${prefix}${formatNumber(delta.abs)} (${delta.pct >= 0 ? '+' : ''}${Math.round(delta.pct)}%)`;
}

function metricRows(input: TeamLeadReportEmailInput): Array<[string, string, string]> {
  return [
    ['Doors', formatNumber(input.totals.doors_knocked), deltaLabel(input.deltas.doors_knocked)],
    ['Flyers', formatNumber(input.totals.flyers_delivered), deltaLabel(input.deltas.flyers_delivered)],
    ['Conversations', formatNumber(input.totals.conversations), deltaLabel(input.deltas.conversations)],
    ['Leads', formatNumber(input.totals.leads_created), deltaLabel(input.deltas.leads_created)],
    ['Appointments', formatNumber(input.totals.appointments_set), deltaLabel(input.deltas.appointments_set)],
    ['Field time', formatDuration(input.totals.time_spent_seconds), deltaLabel(input.deltas.time_spent_seconds)],
    ['Sessions', formatNumber(input.totals.sessions_count), deltaLabel(input.deltas.sessions_count)],
    ['Door-to-convo', formatPercent(input.rates.conversations_per_door), ''],
    ['Convo-to-lead', formatPercent(input.rates.leads_per_conversation), ''],
    ['Appointment rate', formatPercent(input.rates.appointments_per_conversation), ''],
  ];
}

function buildText(input: TeamLeadReportEmailInput): string {
  const periodLabel = titleCase(input.period);
  const lines = [
    `${periodLabel} team report`,
    input.workspaceName,
    formatDateRange(input.periodStart, input.periodEnd),
    '',
    'Summary',
    ...metricRows(input).map(([label, value, delta]) => `${label}: ${value}${delta ? ` (${delta})` : ''}`),
    '',
    'Rep breakdown',
    ...input.members.map((member) => [
      member.display_name,
      `${formatNumber(member.metrics.doors_knocked)} doors`,
      `${formatNumber(member.metrics.conversations)} conversations`,
      `${formatNumber(member.metrics.leads_created)} leads`,
      `${formatNumber(member.metrics.appointments_set)} appointments`,
      `${formatPercent(member.rates.conversations_per_door)} door-to-convo`,
      member.has_report ? member.role : 'missing snapshot',
    ].join(' | ')),
    '',
    `Open report: ${input.dashboardUrl}`,
  ];

  return lines.join('\n');
}

function buildHtml(input: TeamLeadReportEmailInput): string {
  const periodLabel = titleCase(input.period);
  const safeWorkspaceName = escapeHtml(input.workspaceName);
  const safeDateRange = escapeHtml(formatDateRange(input.periodStart, input.periodEnd));
  const safeDashboardUrl = escapeHtml(input.dashboardUrl);
  const generated = input.generatedAt
    ? new Date(input.generatedAt).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
    : null;

  const metricsHtml = metricRows(input).map(([label, value, delta]) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#475569;">${escapeHtml(label)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;color:#0f172a;">${escapeHtml(value)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;color:#64748b;">${escapeHtml(delta)}</td>
    </tr>
  `).join('');

  const membersHtml = input.members.map((member) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-weight:600;">
        ${escapeHtml(member.display_name)}
        <div style="font-size:12px;font-weight:400;color:#64748b;">${escapeHtml(member.has_report ? member.role : 'Missing snapshot')}</div>
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;color:#0f172a;">${formatNumber(member.metrics.doors_knocked)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;color:#0f172a;">${formatNumber(member.metrics.conversations)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;color:#0f172a;">${formatNumber(member.metrics.leads_created)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;color:#0f172a;">${formatNumber(member.metrics.appointments_set)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;text-align:right;color:#0f172a;">${formatPercent(member.rates.conversations_per_door)}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html><html><body>
    <div style="margin:0;padding:32px 18px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;">
      <div style="max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
        <div style="padding:28px 30px 22px;border-bottom:1px solid #e2e8f0;">
          <div style="font-size:28px;line-height:1;font-weight:800;color:#111827;">FLYR</div>
          <h1 style="margin:16px 0 6px;font-size:26px;line-height:1.25;color:#111827;font-weight:800;">${escapeHtml(periodLabel)} team report</h1>
          <p style="margin:0;color:#475569;font-size:15px;">${safeWorkspaceName} - ${safeDateRange}</p>
          ${generated ? `<p style="margin:8px 0 0;color:#64748b;font-size:13px;">Generated ${escapeHtml(generated)}</p>` : ''}
        </div>
        <div style="padding:24px 30px;">
          <table role="presentation" style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
            <tbody>${metricsHtml}</tbody>
          </table>
          <h2 style="margin:28px 0 12px;font-size:18px;color:#111827;">Rep breakdown</h2>
          <table role="presentation" style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;font-size:14px;">
            <thead>
              <tr style="background:#f8fafc;">
                <th align="left" style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:0;">Rep</th>
                <th align="right" style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:0;">Doors</th>
                <th align="right" style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:0;">Convos</th>
                <th align="right" style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:0;">Leads</th>
                <th align="right" style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:0;">Appts</th>
                <th align="right" style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#475569;font-size:12px;text-transform:uppercase;letter-spacing:0;">Rate</th>
              </tr>
            </thead>
            <tbody>${membersHtml}</tbody>
          </table>
          <p style="margin:24px 0 0;">
            <a href="${safeDashboardUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-size:14px;font-weight:700;">Open report</a>
          </p>
        </div>
      </div>
    </div>
  </body></html>`;
}

export function getTeamReportMailerConfigError(): string | null {
  if (!getEnv('RESEND_API_KEY')) {
    return 'Report email was not sent because RESEND_API_KEY is missing or empty.';
  }
  return null;
}

export async function sendTeamLeadReportEmail(
  input: TeamLeadReportEmailInput
): Promise<{ id: string | null }> {
  const apiKey = getEnv('RESEND_API_KEY');
  const configError = getTeamReportMailerConfigError();
  if (configError || !apiKey) {
    throw new Error(configError ?? 'Report email is not configured.');
  }

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from: getEnv('RESEND_FROM_EMAIL') || DEFAULT_FROM_EMAIL,
    to: input.to,
    replyTo: getEnv('RESEND_REPLY_TO') || DEFAULT_REPLY_TO,
    subject: `${titleCase(input.period)} team report: ${input.workspaceName}`,
    html: buildHtml(input),
    text: buildText(input),
  });

  if (error) {
    throw new Error(error.message.trim() || 'Resend email request failed');
  }

  return { id: typeof data?.id === 'string' ? data.id : null };
}
