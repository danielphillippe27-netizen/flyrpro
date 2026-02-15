/**
 * Stripe price IDs from env. Use these for Checkout; never expose secret key to client.
 */
export const STRIPE_PRICE_PRO_MONTHLY =
  process.env.STRIPE_PRICE_PRO_MONTHLY ?? '';
export const STRIPE_PRICE_PRO_YEARLY =
  process.env.STRIPE_PRICE_PRO_YEARLY ?? '';

export const STRIPE_PRICE_CAD_MONTHLY =
  process.env.STRIPE_PRICE_CAD_MONTHLY ?? '';
export const STRIPE_PRICE_USD_MONTHLY =
  process.env.STRIPE_PRICE_USD_MONTHLY ?? '';
export const STRIPE_PRICE_USD_YEARLY =
  process.env.STRIPE_PRICE_USD_YEARLY ?? '';
export const STRIPE_PRICE_CAD_YEARLY =
  process.env.STRIPE_PRICE_CAD_YEARLY ?? '';

export const STRIPE_PRICE_TEAM_MONTHLY =
  process.env.STRIPE_PRICE_TEAM_MONTHLY ?? '';
export const STRIPE_PRICE_TEAM_YEARLY =
  process.env.STRIPE_PRICE_TEAM_YEARLY ?? '';

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

export function getAppUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.APP_BASE_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
}
