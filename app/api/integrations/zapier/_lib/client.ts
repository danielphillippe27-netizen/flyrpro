export type ZapierLeadPayload = {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  source?: string | null;
  campaignId?: string | null;
  createdAt?: string | null;
};

export class ZapierWebhookError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ZapierWebhookError';
    this.status = status;
  }
}

export function validateZapierWebhookUrl(rawValue: string): string {
  const value = rawValue.trim();
  if (!value) {
    throw new ZapierWebhookError('Zapier webhook URL is required');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ZapierWebhookError('Enter a valid Zapier webhook URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new ZapierWebhookError('Zapier webhook URL must use HTTPS');
  }

  if (parsed.hostname !== 'hooks.zapier.com') {
    throw new ZapierWebhookError('Use a Zapier Catch Hook URL from hooks.zapier.com');
  }

  if (!/^\/hooks\/catch\//.test(parsed.pathname)) {
    throw new ZapierWebhookError('Use a Zapier webhook URL from Webhooks by Zapier');
  }

  return parsed.toString();
}

function buildZapierRequestBody(args: {
  event: 'lead_sync' | 'integration_test';
  workspaceId: string;
  lead: ZapierLeadPayload;
  test: boolean;
}) {
  return {
    event: args.event,
    source: 'FLYR',
    test: args.test,
    sentAt: new Date().toISOString(),
    workspaceId: args.workspaceId,
    lead: {
      id: args.lead.id ?? null,
      name: args.lead.name ?? null,
      email: args.lead.email ?? null,
      phone: args.lead.phone ?? null,
      address: args.lead.address ?? null,
      notes: args.lead.notes ?? null,
      source: args.lead.source ?? 'FLYR',
      campaignId: args.lead.campaignId ?? null,
      createdAt: args.lead.createdAt ?? null,
    },
    id: args.lead.id ?? null,
    name: args.lead.name ?? null,
    email: args.lead.email ?? null,
    phone: args.lead.phone ?? null,
    address: args.lead.address ?? null,
    notes: args.lead.notes ?? null,
    campaignId: args.lead.campaignId ?? null,
    createdAt: args.lead.createdAt ?? null,
  };
}

export class ZapierWebhookClient {
  async sendLead(webhookUrl: string, workspaceId: string, lead: ZapierLeadPayload) {
    return this.post(
      webhookUrl,
      buildZapierRequestBody({
        event: 'lead_sync',
        workspaceId,
        lead,
        test: false,
      })
    );
  }

  async sendTestLead(webhookUrl: string, workspaceId: string, lead: ZapierLeadPayload) {
    return this.post(
      webhookUrl,
      buildZapierRequestBody({
        event: 'integration_test',
        workspaceId,
        lead,
        test: true,
      })
    );
  }

  private async post(webhookUrl: string, payload: ReturnType<typeof buildZapierRequestBody>) {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'FLYR-Zapier-Integration/1.0',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ZapierWebhookError(
        body?.trim() || `Zapier webhook returned ${response.status}`,
        response.status
      );
    }

    return {
      status: response.status,
    };
  }
}
