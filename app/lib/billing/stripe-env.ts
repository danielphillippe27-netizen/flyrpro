export type StripeMode = 'test' | 'live';

function firstNonEmpty(...values: Array<string | undefined | null>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function getStripeMode(): StripeMode {
  const raw = (process.env.STRIPE_MODE ?? '').trim().toLowerCase();
  if (raw === 'test' || raw === 'live') return raw;
  return process.env.NODE_ENV === 'production' ? 'live' : 'test';
}

export function isStripeTestMode(): boolean {
  return getStripeMode() === 'test';
}

export function getStripeSecretKey(): string {
  if (getStripeMode() === 'test') {
    const key = firstNonEmpty(
      process.env.STRIPE_SECRET_KEY_TEST,
      process.env.STRIPE_SECRET_KEY,
      'sk_test_placeholder'
    );
    // Guard against accidental live charges while test mode is selected.
    if (key.startsWith('sk_live')) return 'sk_test_placeholder';
    return key;
  }

  const key = firstNonEmpty(
    process.env.STRIPE_SECRET_KEY_LIVE,
    process.env.STRIPE_SECRET_KEY,
    'sk_test_placeholder'
  );
  // Guard against accidental test keys in live mode.
  if (key.startsWith('sk_test')) return 'sk_test_placeholder';
  return key;
}

export function isStripeSecretKeyConfigured(): boolean {
  return getStripeSecretKey() !== 'sk_test_placeholder';
}

export function getStripeWebhookSecret(): string {
  if (getStripeMode() === 'test') {
    return firstNonEmpty(
      process.env.STRIPE_WEBHOOK_SECRET_TEST,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  }

  return firstNonEmpty(
    process.env.STRIPE_WEBHOOK_SECRET_LIVE,
    process.env.STRIPE_WEBHOOK_SECRET
  );
}

export function getStripePriceEnv(baseName: string): string {
  if (getStripeMode() === 'test') {
    return firstNonEmpty(
      process.env[`${baseName}_TEST`],
      process.env[baseName]
    );
  }

  return firstNonEmpty(
    process.env[`${baseName}_LIVE`],
    process.env[baseName]
  );
}
