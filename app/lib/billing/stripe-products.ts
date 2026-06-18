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
export const STRIPE_PRICE_DIALER_CAD_MONTHLY =
  getStripePriceEnv('STRIPE_PRICE_DIALER_CAD_MONTHLY');
export const STRIPE_PRICE_DIALER_USD_MONTHLY =
  getStripePriceEnv('STRIPE_PRICE_DIALER_USD_MONTHLY');
export const STRIPE_PRICE_DIALER_MONTHLY =
  getStripePriceEnv('STRIPE_PRICE_DIALER_MONTHLY');

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
  STRIPE_PRICE_DIALER_CAD_MONTHLY,
  STRIPE_PRICE_DIALER_USD_MONTHLY,
  STRIPE_PRICE_DIALER_MONTHLY,
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

function normalizeOrigin(candidate: string | null | undefined): string | null {
  if (!candidate) return null;

  try {
    return new URL(candidate).origin.replace(/\/$/, '');
  } catch {
    return null;
  }
}

function isLocalOrigin(origin: string | null | undefined): boolean {
  if (!origin) return true;

  try {
    const { hostname } = new URL(origin);
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname.endsWith('.local')
    );
  } catch {
    return true;
  }
}

export function getPublicAppUrl(
  request?: string | URL | { url: string }
): string | null {
  const envCandidates = [
    normalizeOrigin(process.env.APP_BASE_URL),
    normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL),
  ].filter((candidate): candidate is string => Boolean(candidate));

  const publicEnvOrigin = envCandidates.find((candidate) => !isLocalOrigin(candidate));
  if (publicEnvOrigin) {
    return publicEnvOrigin;
  }

  if (request) {
    try {
      const url =
        typeof request === 'string'
          ? new URL(request)
          : request instanceof URL
            ? request
            : new URL(request.url);
      const requestOrigin = url.origin.replace(/\/$/, '');
      if (!isLocalOrigin(requestOrigin)) {
        return requestOrigin;
      }
    } catch {
      // Ignore invalid request URLs and fall through to null below.
    }
  }

  return null;
}

export type BillingCurrency = 'USD' | 'CAD';

export function getBillingCurrencyFromCountry(country: string | null | undefined): BillingCurrency {
  return country === 'CA' ? 'CAD' : 'USD';
}

export function getRequestBillingCurrency(
  request?: Request | { headers?: Headers | { get?: (name: string) => string | null } } | null
): BillingCurrency {
  const headers = request?.headers;
  const country =
    headers?.get?.('x-vercel-ip-country') ??
    headers?.get?.('cf-ipcountry') ??
    null;
  return getBillingCurrencyFromCountry(country);
}

export function getPowerDialerAddonPriceId(currency: BillingCurrency): string {
  if (currency === 'USD') {
    return STRIPE_PRICE_DIALER_USD_MONTHLY || STRIPE_PRICE_DIALER_MONTHLY || '';
  }
  return STRIPE_PRICE_DIALER_CAD_MONTHLY || STRIPE_PRICE_DIALER_MONTHLY || '';
}

export function getAllPowerDialerAddonPriceIds(): string[] {
  return [
    STRIPE_PRICE_DIALER_CAD_MONTHLY,
    STRIPE_PRICE_DIALER_USD_MONTHLY,
    STRIPE_PRICE_DIALER_MONTHLY,
  ].filter(Boolean);
}

export function getPowerDialerAddonOffer(currency: BillingCurrency): {
  priceId: string;
  amount: string;
  currency: BillingCurrency;
  period: string;
} {
  return {
    priceId: getPowerDialerAddonPriceId(currency),
    amount: currency === 'USD' ? '14.99' : '19.99',
    currency,
    period: '/month',
  };
}
