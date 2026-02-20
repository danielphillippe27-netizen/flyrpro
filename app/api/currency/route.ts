import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/currency
 * Returns country and currency from request (e.g. Vercel x-vercel-ip-country).
 * Used by subscribe/paywall to show USD vs CAD and Canadian discount.
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
  // Default to CAD when country unknown (e.g. local dev); US gets USD
  const currency = country === 'US' ? 'USD' : 'CAD';
  return NextResponse.json({ country: country ?? 'CA', currency });
}
