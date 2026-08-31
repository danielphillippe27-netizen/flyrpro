import { ImageResponse } from 'next/og';

export const alt = 'Build your free WolfGrid 3D prospecting map';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function FreeMapOpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: 'center',
          background: '#09090b',
          color: 'white',
          display: 'flex',
          height: '100%',
          justifyContent: 'space-between',
          overflow: 'hidden',
          padding: '72px 76px',
          position: 'relative',
          width: '100%',
        }}
      >
        <div
          style={{
            background: 'rgba(239,68,68,0.28)',
            borderRadius: 999,
            display: 'flex',
            filter: 'blur(55px)',
            height: 360,
            position: 'absolute',
            right: -60,
            top: -100,
            width: 360,
          }}
        />

        <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 710 }}>
          <div style={{ color: '#f87171', display: 'flex', fontSize: 24, fontWeight: 800, letterSpacing: 3 }}>
            WOLFGRID · FREE CAMPAIGN
          </div>
          <div style={{ display: 'flex', fontSize: 72, fontWeight: 900, letterSpacing: -4, lineHeight: 0.95, marginTop: 28 }}>
            Build your free 3D prospecting map.
          </div>
          <div style={{ color: '#a1a1aa', display: 'flex', fontSize: 26, fontWeight: 600, marginTop: 30 }}>
            Pick a neighborhood. Select up to 1,000 homes. Launch your campaign.
          </div>
        </div>

        <div
          style={{
            alignItems: 'center',
            background: '#18181b',
            border: '2px solid rgba(255,255,255,0.12)',
            borderRadius: 42,
            boxShadow: '0 30px 80px rgba(0,0,0,0.55)',
            display: 'flex',
            height: 410,
            justifyContent: 'center',
            position: 'relative',
            transform: 'rotate(3deg)',
            width: 310,
          }}
        >
          <div
            style={{
              background: 'linear-gradient(145deg,#27272a,#09090b)',
              borderRadius: 30,
              display: 'flex',
              height: 386,
              overflow: 'hidden',
              position: 'relative',
              width: 286,
            }}
          >
            <div
              style={{
                background: 'rgba(239,68,68,0.32)',
                border: '4px solid #ef4444',
                clipPath: 'polygon(16% 30%, 82% 20%, 95% 67%, 56% 88%, 10% 72%)',
                display: 'flex',
                height: 260,
                left: 18,
                position: 'absolute',
                top: 34,
                width: 250,
              }}
            />
            <div
              style={{
                background: 'rgba(9,9,11,0.92)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 22,
                bottom: 16,
                display: 'flex',
                flexDirection: 'column',
                left: 16,
                padding: '16px 18px',
                position: 'absolute',
                right: 16,
              }}
            >
              <div style={{ color: '#a1a1aa', display: 'flex', fontSize: 15, fontWeight: 700 }}>HOMES SELECTED</div>
              <div style={{ display: 'flex', fontSize: 38, fontWeight: 900, marginTop: 3 }}>326</div>
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
