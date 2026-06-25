import { ImageResponse } from 'next/og';

export const alt = 'FLYR 3D prospecting map';
export const size = {
  width: 1200,
  height: 630,
};

export const contentType = 'image/png';

const logoUrl = new URL('/flyr-logo-wide-dark.svg', 'https://www.flyrpro.app').toString();

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#050505',
          color: '#ffffff',
          padding: '72px',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '26px',
          }}
        >
          <img
            src={logoUrl}
            alt="FLYR logo"
            width="430"
            height="204"
            style={{
              objectFit: 'contain',
            }}
          />
          <div
            style={{
              fontSize: 34,
              fontWeight: 500,
              letterSpacing: 0,
              lineHeight: 1.1,
              color: 'rgba(255,255,255,0.78)',
            }}
          >
            3D prospecting map
          </div>
        </div>
      </div>
    ),
    size
  );
}
