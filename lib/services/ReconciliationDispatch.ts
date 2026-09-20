/** Only server-owned deployment configuration may receive the worker credential. */
export async function dispatchReconciliationRun(runId: string): Promise<boolean> {
  const host = process.env.VERCEL_URL?.trim();
  const secret = process.env.CRON_SECRET?.trim();
  if (!host || !secret) return false;
  // VERCEL_URL is a deployment hostname, never a client-supplied request origin.
  if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app$/i.test(host)) return false;
  const headers: Record<string, string> = {
    authorization: `Bearer ${secret}`,
    'content-type': 'application/json',
  };
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (bypass) headers['x-vercel-protection-bypass'] = bypass;
  try {
    const response = await fetch(`https://${host}/api/internal/map-reconciliation`, {
      method: 'POST', headers, body: JSON.stringify({ runId }),
      signal: AbortSignal.timeout(10_000), redirect: 'error',
    });
    return response.status === 202;
  } catch {
    // The persisted queue and cron remain authoritative if dispatch fails.
    return false;
  }
}
