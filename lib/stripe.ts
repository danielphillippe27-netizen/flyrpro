import Stripe from 'stripe';
import { getStripeSecretKey } from '@/app/lib/billing/stripe-env';

export const stripe = new Stripe(getStripeSecretKey(), {
  apiVersion: '2025-09-30.clover',
  typescript: true,
});
