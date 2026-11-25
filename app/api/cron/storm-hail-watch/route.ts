import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({ error: 'Hail point collection has been retired.' }, { status: 410 });
}
