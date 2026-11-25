import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json(
    { error: 'WolfGrid Storm Maps covers Canada and the United States.' },
    { status: 410 },
  );
}
