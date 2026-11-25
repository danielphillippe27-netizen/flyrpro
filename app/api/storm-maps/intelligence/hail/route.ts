import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({ error: 'Location hail archive lookup has been retired.' }, { status: 410 });
}
