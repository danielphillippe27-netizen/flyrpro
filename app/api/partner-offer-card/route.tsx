import { ImageResponse } from 'next/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const template = request.nextUrl.searchParams.get('template');

  if (template !== 'just-listed-dm') {
    return new Response('Unsupported partner offer card template', { status: 400 });
  }

  const origin = request.nextUrl.origin;
  const logoUrl = `${origin}/flyr-download-icon.png`;

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background:
            'radial-gradient(circle at top, rgba(239,68,68,0.24), rgba(9,9,11,1) 44%)',
          color: 'white',
          textAlign: 'center',
          padding: '48px',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt="FLYR logo"
          width="220"
          height="220"
          style={{
            objectFit: 'contain',
          }}
        />
        <div
          style={{
            marginTop: '28px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div
            style={{
              fontSize: '42px',
              fontWeight: 600,
              lineHeight: 1.1,
              color: 'rgba(255,255,255,0.9)',
            }}
          >
            Door-to-door software
          </div>
          <div
            style={{
              fontSize: '68px',
              fontWeight: 800,
              lineHeight: 1,
            }}
          >
            Leverage your listing
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    }
  );
}
