import { NextRequest, NextResponse } from 'next/server';
import { getDefaultUpgradePriceId } from '@/app/lib/billing/stripe-products';

export async function POST(request: NextRequest) {
  try {
    const priceId = getDefaultUpgradePriceId();
    if (!priceId) {
      return NextResponse.json(
        { error: 'No default Stripe price configured.' },
        { status: 500 }
      );
    }

    const checkoutUrl = new URL('/api/billing/stripe/checkout', request.url);
    const upstream = await fetch(checkoutUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(request.headers.get('cookie')
          ? { cookie: request.headers.get('cookie') as string }
          : {}),
        ...(request.headers.get('authorization')
          ? { authorization: request.headers.get('authorization') as string }
          : {}),
      },
      body: JSON.stringify({ priceId }),
      cache: 'no-store',
    });

    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return NextResponse.json(
        { error: payload?.error ?? 'Failed to create checkout session' },
        { status: upstream.status || 500 }
      );
    }

    if (typeof payload?.url !== 'string' || !payload.url) {
      return NextResponse.json(
        { error: 'Checkout session URL was not returned.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: payload.url });
  } catch (error) {
    console.error('Error creating editor billing session:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
