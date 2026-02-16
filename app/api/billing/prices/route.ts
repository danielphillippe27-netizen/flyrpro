import { NextResponse } from 'next/server';
import {
  STRIPE_PRICE_USD_MONTHLY,
  STRIPE_PRICE_USD_YEARLY,
  STRIPE_PRICE_CAD_MONTHLY,
  STRIPE_PRICE_CAD_YEARLY,
} from '@/app/lib/billing/stripe-products';

export interface PriceOption {
  priceId: string;
  name: string;
  amount: string;
  period: string;
  currency: 'USD' | 'CAD';
  interval: 'month' | 'year';
}

/**
 * GET /api/billing/prices
 * Returns public price options for the pricing page (no auth required).
 */
export async function GET() {
  const prices: PriceOption[] = [];

  if (STRIPE_PRICE_USD_MONTHLY) {
    prices.push({
      priceId: STRIPE_PRICE_USD_MONTHLY,
      name: 'Pro Monthly',
      amount: '30',
      period: '/month',
      currency: 'USD',
      interval: 'month',
    });
  }
  if (STRIPE_PRICE_USD_YEARLY) {
    prices.push({
      priceId: STRIPE_PRICE_USD_YEARLY,
      name: 'Pro Yearly',
      amount: '300',
      period: '/year',
      currency: 'USD',
      interval: 'year',
    });
  }
  if (STRIPE_PRICE_CAD_MONTHLY) {
    prices.push({
      priceId: STRIPE_PRICE_CAD_MONTHLY,
      name: 'Pro Monthly',
      amount: '39.99',
      period: '/month',
      currency: 'CAD',
      interval: 'month',
    });
  }
  if (STRIPE_PRICE_CAD_YEARLY) {
    prices.push({
      priceId: STRIPE_PRICE_CAD_YEARLY,
      name: 'Pro Yearly',
      amount: '400',
      period: '/year',
      currency: 'CAD',
      interval: 'year',
    });
  }

  return NextResponse.json({ prices });
}
