import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({ error: 'Xweather map service has been retired.' }, { status: 410 });
}

export const POST = GET;
