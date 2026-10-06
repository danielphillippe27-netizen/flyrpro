import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const alt = 'WolfGrid 3D prospecting map';
export const size = {
  width: 1200,
  height: 630,
};

export const contentType = 'image/png';

export default async function OpenGraphImage() {
  const logo = await readFile(join(process.cwd(), 'public/brand/wolfgrid-share-logo.png'));
  const logoSrc = `data:image/png;base64,${logo.toString('base64')}`;
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
            src={logoSrc}
            alt="WolfGrid"
            width={960}
            height={145}
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
