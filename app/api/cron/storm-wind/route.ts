import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({ error: 'Wind archive collection has been retired.' }, { status: 410 });
}
