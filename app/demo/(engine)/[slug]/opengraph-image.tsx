import { ImageResponse } from 'next/og';
import { headers } from 'next/headers';
import { resolvePayloadForSlug } from '@/lib/demo/resolvePayload';

export const runtime = 'edge';
export const alt = 'WolfGrid demo';
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

type DemoOgImageProps = {
  params: Promise<{ slug: string }>;
};

const INK = '#0c0c0a';
const PAPER = '#d9d5cb';
const PAPER_DEEP = '#cfcabe';
const ORANGE = '#ff4d00';

let archivoFontPromise: Promise<ArrayBuffer> | null = null;

function originFromHeaders(headerStore: Headers) {
  const host = headerStore.get('host') || 'localhost:3000';
  const forwardedProto = headerStore.get('x-forwarded-proto');
  const protocol = forwardedProto || (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');

  return `${protocol}://${host}`;
}

function getArchivoFont(origin: string) {
  archivoFontPromise ??= fetch(new URL('/fonts/Archivo-Black.ttf', origin), {
    cache: 'force-cache',
  }).then((fontResponse) => {
    if (!fontResponse.ok) {
      throw new Error(`Failed to fetch Archivo font: ${fontResponse.status}`);
    }

    return fontResponse.arrayBuffer();
  });

  return archivoFontPromise;
}

function titleCaseCity(city?: string) {
  const value = city?.trim();
  if (!value) return undefined;

  return value
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

const grainFlecks = Array.from({ length: 140 }, (_, index) => {
  const x = (index * 73) % 1200;
  const y = (index * 151) % 630;
  const opacity = 0.03 + ((index * 17) % 7) * 0.008;
  const size = 1 + (index % 3);

  return { x, y, opacity, size };
});

export default async function DemoOpenGraphImage({ params }: DemoOgImageProps) {
  const { slug } = await params;
  const origin = originFromHeaders(await headers());
  const [payload, archivoFont] = await Promise.all([
    resolvePayloadForSlug(slug),
    getArchivoFont(origin).catch((error) => {
      console.error('[demo-og] Falling back to default font after Archivo fetch failed:', error);
      return null;
    }),
  ]);
  const city = titleCaseCity(payload.city);
  const company = payload.company?.trim() || 'WolfGrid';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          overflow: 'hidden',
          background: INK,
          color: PAPER,
          fontFamily: archivoFont ? 'Archivo' : 'Arial',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            backgroundImage:
              'radial-gradient(circle at 18% 22%, rgba(255,77,0,0.16) 0, transparent 26%), radial-gradient(circle at 74% 80%, rgba(217,213,203,0.11) 0, transparent 30%)',
          }}
        />
        {grainFlecks.map((fleck, index) => (
          <div
            key={index}
            style={{
              position: 'absolute',
              left: fleck.x,
              top: fleck.y,
              width: fleck.size,
              height: fleck.size,
              background: PAPER_DEEP,
              opacity: fleck.opacity,
            }}
          />
        ))}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            width: '100%',
            height: '100%',
            padding: '74px 82px 62px',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 28,
            }}
          >
            <div
              style={{
                display: 'flex',
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: 7,
                textTransform: 'uppercase',
                color: PAPER_DEEP,
              }}
            >
              {company}
            </div>
            <div
              style={{
                display: 'flex',
                position: 'relative',
                width: '100%',
                height: 240,
                fontWeight: 900,
                letterSpacing: -2,
                lineHeight: 0.9,
                textTransform: 'uppercase',
                maxWidth: 1000,
              }}
            >
              {city ? (
                <>
                  <div style={{ display: 'flex', position: 'absolute', top: 0, left: 0, fontSize: 106, color: PAPER }}>
                    EVERY DOOR
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      position: 'absolute',
                      top: 110,
                      left: 0,
                      fontSize: city.length > 16 ? 84 : 96,
                      color: ORANGE,
                    }}
                  >
                    {`IN ${city}.`}
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: 'flex', position: 'absolute', top: 0, left: 0, fontSize: 102, color: PAPER }}>
                    EVERY DOOR.
                  </div>
                  <div style={{ display: 'flex', position: 'absolute', top: 108, left: 0, fontSize: 102, color: ORANGE }}>
                    VERIFIED.
                  </div>
                </>
              )}
            </div>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              gap: 32,
            }}
          >
            <div
              style={{
                display: 'flex',
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: 7,
                textTransform: 'uppercase',
              }}
            >
              <span>WolfGrid&nbsp;</span>
              <span style={{ color: ORANGE }}>PRO</span>
            </div>
            <div
              style={{
                display: 'flex',
                fontSize: 16,
                fontWeight: 700,
                letterSpacing: 5,
                textTransform: 'uppercase',
                color: PAPER_DEEP,
              }}
            >
              Field operations, verified
            </div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: archivoFont
        ? [
            {
              name: 'Archivo',
              data: archivoFont,
              weight: 900,
              style: 'normal',
            },
          ]
        : [],
    }
  );
}
