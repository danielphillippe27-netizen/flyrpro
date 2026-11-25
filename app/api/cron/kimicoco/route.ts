import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({ error: 'Automatic KimiCoco sync has been removed.' }, { status: 410 });
}
