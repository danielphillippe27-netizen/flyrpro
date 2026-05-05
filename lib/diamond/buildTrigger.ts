type DiamondBuildTriggerPayload = {
  campaignId: string;
  reason: string;
  source?: string;
  addressCount?: number;
  buildingCount?: number;
  mapMode?: string;
};

type DiamondBuildTriggerResult =
  | { status: 'queued'; statusCode: number }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; statusCode?: number; error: string };

const DEFAULT_TIMEOUT_MS = 5000;

function timeoutSignal(timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

export async function triggerDiamondBuild(
  payload: DiamondBuildTriggerPayload
): Promise<DiamondBuildTriggerResult> {
  const webhookUrl = process.env.DIAMOND_BUILD_WEBHOOK_URL?.trim();

  if (!webhookUrl) {
    return {
      status: 'skipped',
      reason: 'DIAMOND_BUILD_WEBHOOK_URL is not configured',
    };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const webhookSecret = process.env.DIAMOND_BUILD_WEBHOOK_SECRET?.trim();
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
      signal: timeoutSignal(Number(process.env.DIAMOND_BUILD_WEBHOOK_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS),
    });

    if (!response.ok) {
      return {
        status: 'failed',
        statusCode: response.status,
        error: `Diamond build webhook returned ${response.status}`,
      };
    }

    return {
      status: 'queued',
      statusCode: response.status,
    };
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown Diamond build webhook error',
    };
  }
}

export type { DiamondBuildTriggerPayload, DiamondBuildTriggerResult };
