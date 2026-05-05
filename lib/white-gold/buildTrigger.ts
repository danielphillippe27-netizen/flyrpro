type WhiteGoldBuildTriggerPayload = {
  campaignId: string;
  reason: string;
  source?: string;
  addressCount?: number;
  buildingCount?: number;
  mapMode?: string;
};

type WhiteGoldBuildTriggerResult =
  | { status: 'queued'; statusCode: number }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; statusCode?: number; error: string };

const DEFAULT_TIMEOUT_MS = 5000;

function timeoutSignal(timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

export async function triggerWhiteGoldBuild(
  payload: WhiteGoldBuildTriggerPayload
): Promise<WhiteGoldBuildTriggerResult> {
  const explicitWebhookUrl = process.env.WHITE_GOLD_BUILD_WEBHOOK_URL?.trim();
  const diamondWebhookUrl = process.env.DIAMOND_BUILD_WEBHOOK_URL?.trim();
  const derivedWebhookUrl =
    diamondWebhookUrl && /\/diamond-build\/?$/.test(diamondWebhookUrl)
      ? diamondWebhookUrl.replace(/\/diamond-build\/?$/, '/white-gold-build')
      : null;
  const webhookUrl = explicitWebhookUrl || derivedWebhookUrl;

  if (!webhookUrl) {
    return {
      status: 'skipped',
      reason: 'WHITE_GOLD_BUILD_WEBHOOK_URL is not configured',
    };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const webhookSecret =
    process.env.WHITE_GOLD_BUILD_WEBHOOK_SECRET?.trim() ||
    process.env.DIAMOND_BUILD_WEBHOOK_SECRET?.trim();
  if (webhookSecret) {
    headers.Authorization = `Bearer ${webhookSecret}`;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...payload,
        requestedAt: new Date().toISOString(),
      }),
      signal: timeoutSignal(Number(process.env.WHITE_GOLD_BUILD_WEBHOOK_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      return {
        status: 'failed',
        statusCode: response.status,
        error: `White Gold build webhook returned ${response.status}`,
      };
    }

    return {
      status: 'queued',
      statusCode: response.status,
    };
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown White Gold build webhook error',
    };
  }
}

export type { WhiteGoldBuildTriggerPayload, WhiteGoldBuildTriggerResult };
