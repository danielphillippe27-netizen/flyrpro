/**
 * Stripe price IDs from env. Use these for Checkout; never expose secret key to client.
 */
import { getStripePriceEnv } from '@/app/lib/billing/stripe-env';

export const STRIPE_PRICE_PRO_MONTHLY =
  getStripePriceEnv('STRIPE_PRICE_PRO_MONTHLY');
export const STRIPE_PRICE_PRO_YEARLY =
  getStripePriceEnv('STRIPE_PRICE_PRO_YEARLY');

export const STRIPE_PRICE_CAD_MONTHLY =
  getStripePriceEnv('STRIPE_PRICE_CAD_MONTHLY');
export const STRIPE_PRICE_USD_MONTHLY =
  getStripePriceEnv('STRIPE_PRICE_USD_MONTHLY');
export const STRIPE_PRICE_USD_YEARLY =
  getStripePriceEnv('STRIPE_PRICE_USD_YEARLY');
export const STRIPE_PRICE_CAD_YEARLY =
  getStripePriceEnv('STRIPE_PRICE_CAD_YEARLY');

export const STRIPE_PRICE_TEAM_MONTHLY =
  getStripePriceEnv('STRIPE_PRICE_TEAM_MONTHLY');
export const STRIPE_PRICE_TEAM_YEARLY =
  getStripePriceEnv('STRIPE_PRICE_TEAM_YEARLY');

/** Allowed price IDs for checkout (allowlist). */
export const STRIPE_ALLOWED_PRICE_IDS = [
  STRIPE_PRICE_PRO_MONTHLY,
  STRIPE_PRICE_PRO_YEARLY,
  STRIPE_PRICE_CAD_MONTHLY,
  STRIPE_PRICE_USD_MONTHLY,
  STRIPE_PRICE_USD_YEARLY,
  STRIPE_PRICE_CAD_YEARLY,
  STRIPE_PRICE_TEAM_MONTHLY,
  STRIPE_PRICE_TEAM_YEARLY,
].filter(Boolean);

/** Pro price IDs (for webhook plan mapping). */
const PRO_PRICE_IDS = new Set([
  STRIPE_PRICE_PRO_MONTHLY,
  STRIPE_PRICE_PRO_YEARLY,
  STRIPE_PRICE_CAD_MONTHLY,
  STRIPE_PRICE_USD_MONTHLY,
  STRIPE_PRICE_USD_YEARLY,
  STRIPE_PRICE_CAD_YEARLY,
].filter(Boolean));

/** First available Pro price ID for "Upgrade to Pro" (Billing/Settings). */
export function getDefaultUpgradePriceId(): string {
  return (
    STRIPE_PRICE_PRO_MONTHLY ||
    STRIPE_PRICE_USD_MONTHLY ||
    STRIPE_PRICE_CAD_MONTHLY ||
    STRIPE_PRICE_PRO_YEARLY ||
    STRIPE_PRICE_USD_YEARLY ||
    STRIPE_PRICE_CAD_YEARLY ||
    ''
  );
}

/** Resolve Pro price ID by plan and currency (for subscribe/paywall checkout). Never returns monthly for annual. */
export function getProPriceId(plan: 'annual' | 'monthly', currency: 'USD' | 'CAD'): string {
  if (plan === 'annual') {
    return currency === 'CAD'
      ? STRIPE_PRICE_CAD_YEARLY || ''
      : STRIPE_PRICE_USD_YEARLY || STRIPE_PRICE_PRO_YEARLY || '';
  }
  return currency === 'CAD'
    ? STRIPE_PRICE_CAD_MONTHLY || ''
    : STRIPE_PRICE_USD_MONTHLY || STRIPE_PRICE_PRO_MONTHLY || '';
}

/** Map Stripe price ID to plan for webhook. */
export function planFromStripePriceId(priceId: string): 'pro' | 'team' | 'free' {
  if (PRO_PRICE_IDS.has(priceId)) return 'pro';
  if (
    priceId === STRIPE_PRICE_TEAM_MONTHLY ||
    priceId === STRIPE_PRICE_TEAM_YEARLY
  ) {
    return 'team';
  }
  return 'free';
}

export function getAppUrl(request?: string | URL | { url: string }): string {
  if (request) {
    try {
      const url =
        typeof request === 'string'
          ? new URL(request)
          : request instanceof URL
            ? request
            : new URL(request.url);
      return url.origin.replace(/\/$/, '');
    } catch {
      // Fall through to env-based fallback below.
    }
  }

  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_BASE_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
}
