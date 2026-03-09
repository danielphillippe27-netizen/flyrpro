import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const imageUrl = typeof body?.imageUrl === 'string' ? body.imageUrl.trim() : '';
    if (!imageUrl) {
      return NextResponse.json(
        { error: "Missing or invalid 'imageUrl' in request body" },
        { status: 400 }
      );
    }

    const upstream = await fetch(new URL('/api/background-remover', request.url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl }),
      cache: 'no-store',
    });
    const payload = await upstream.json().catch(() => ({}));

    if (!upstream.ok || typeof payload?.url !== 'string') {
      return NextResponse.json(
        { error: payload?.error ?? 'Failed to remove background' },
        { status: upstream.status || 500 }
      );
    }

    return NextResponse.json({ data: { url: payload.url } });
  } catch (error) {
    console.error('Editor AI remove-bg error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to remove background' },
      { status: 500 }
    );
  }
}
