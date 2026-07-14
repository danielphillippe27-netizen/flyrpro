import type Stripe from 'stripe';

type IndividualPrefillInput = {
  email: string;
  fullName: string;
  title: string;
};

type BusinessProfilePrefillInput = {
  origin?: string;
  productDescription: string;
};

function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

export function buildIndividualConnectPrefill(
  input: IndividualPrefillInput
): Stripe.AccountCreateParams.Individual & Stripe.AccountUpdateParams.Individual {
  const { firstName, lastName } = splitFullName(input.fullName);
  const individual: Stripe.AccountCreateParams.Individual = {
    email: input.email.trim(),
    relationship: {
      title: input.title,
    },
  };

  if (firstName) individual.first_name = firstName;
  if (lastName) individual.last_name = lastName;

  return individual;
}

function normalizePublicHttpsUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:') return null;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

export function buildConnectBusinessProfilePrefill(
  input: BusinessProfilePrefillInput
): Stripe.AccountCreateParams.BusinessProfile & Stripe.AccountUpdateParams.BusinessProfile {
  const url =
    normalizePublicHttpsUrl(process.env.NEXT_PUBLIC_APP_URL) ??
    normalizePublicHttpsUrl(process.env.APP_BASE_URL) ??
    normalizePublicHttpsUrl(input.origin) ??
    'https://wolfgrid.app';

  return {
    product_description: input.productDescription,
    url,
  };
}

export function isMissingStripeConnectAccountError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const maybeStripeError = error as { code?: unknown; message?: unknown };
  const message =
    typeof maybeStripeError.message === 'string'
      ? maybeStripeError.message.toLowerCase()
      : '';

  return (
    maybeStripeError.code === 'resource_missing' ||
    maybeStripeError.code === 'account_invalid' ||
    message.includes('no such account') ||
    message.includes('not connected to your platform') ||
    (message.includes('account') && message.includes('does not exist'))
  );
}
