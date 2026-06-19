import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/currency
 * Returns country and currency from request (e.g. Vercel x-vercel-ip-country).
 * Used by subscribe/paywall to show USD globally and CAD in Canada.
 * Query ?currency=CAD or ?currency=USD overrides (for testing).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const override = searchParams.get('currency');
  if (override === 'CAD' || override === 'USD') {
    return NextResponse.json({
      country: override === 'CAD' ? 'CA' : 'US',
      currency: override,
    });
  }
  const country =
    request.headers.get('x-vercel-ip-country') ??
    request.headers.get('cf-ipcountry') ??
    null;
  // Canada gets CAD; every other country, including unknown local dev, gets USD.
  const currency = country === 'CA' ? 'CAD' : 'USD';
  return NextResponse.json({ country: country ?? 'US', currency });
}
