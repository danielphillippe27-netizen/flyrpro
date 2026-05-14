import Stripe from 'stripe';
import { getStripeSecretKey } from '@/app/lib/billing/stripe-env';

export const stripe = new Stripe(getStripeSecretKey(), {
  apiVersion: '2025-10-29.clover',
  typescript: true,
});
