import Stripe from 'stripe';
import { getStripeMode } from '@/app/lib/billing/stripe-env';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && typeof error.message === 'string') {
    return error.message;
  }
  return '';
}

export function isStripeCrossModeError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes('a similar object exists in live mode') ||
    message.includes('a similar object exists in test mode')
  );
}

export function isStripeNoSuchCustomerError(error: unknown): boolean {
  if (!(error instanceof Stripe.errors.StripeError)) return false;
  if (error.code !== 'resource_missing') return false;
  return getErrorMessage(error).toLowerCase().includes('no such customer');
}

export function getStripeCrossModeMessage(): string {
  const mode = getStripeMode();
  const otherMode = mode === 'live' ? 'test' : 'live';
  return `Stripe customer belongs to ${otherMode} mode, but the server is using ${mode} mode keys. Configure STRIPE_MODE and Stripe keys to the same mode as this customer.`;
}
