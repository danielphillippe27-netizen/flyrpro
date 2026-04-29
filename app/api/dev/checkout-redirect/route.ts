import { NextRequest, NextResponse } from 'next/server';

function normalizePlan(value: string | null): 'annual' | 'monthly' {
  return value === 'monthly' ? 'monthly' : 'annual';
}

function normalizeCurrency(value: string | null): 'CAD' | 'USD' {
  return value === 'USD' ? 'USD' : 'CAD';
}

function normalizeSeats(value: string | null): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(100, parsed);
}

export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const plan = normalizePlan(request.nextUrl.searchParams.get('plan'));
  const currency = normalizeCurrency(request.nextUrl.searchParams.get('currency'));
  const seats = normalizeSeats(request.nextUrl.searchParams.get('seats'));

  const checkoutResponse = await fetch(
    new URL('/api/billing/stripe/checkout', request.url),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: request.headers.get('cookie') ?? '',
      },
      body: JSON.stringify({ plan, currency, seats }),
      cache: 'no-store',
    }
  );

  const payload = await checkoutResponse.json().catch(() => null);

  if (!checkoutResponse.ok || !payload?.url) {
    return NextResponse.json(
      {
        error: payload?.error ?? 'Failed to start checkout',
        status: checkoutResponse.status,
      },
      { status: checkoutResponse.status || 500 }
    );
  }

  return NextResponse.redirect(payload.url);
}
