import sharp from 'sharp';

type AddressParts = {
  address?: string | null;
  formatted?: string | null;
  house_number?: string | null;
  street_name?: string | null;
  locality?: string | null;
  region?: string | null;
  postal_code?: string | null;
};

const DEFAULT_QR_SIZE = 512;
const CENTER_BADGE_HEIGHT = 76;
const CENTER_BADGE_MIN_WIDTH = 128;
const CENTER_BADGE_MAX_WIDTH = 193;
const STREET_MAX_CHARS = 10;
const GLYPH_ROWS = 7;
const GLYPH_COLS = 5;
const GLYPH_GAP = 1;

const BITMAP_FONT: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  5: ['11111', '10000', '10000', '11110', '00001', '00001', '11110'],
  6: ['01110', '10000', '10000', '11110', '10001', '10001', '01110'],
  7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  9: ['01110', '10001', '10001', '01111', '00001', '00001', '01110'],
};

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength).trimEnd();
}

export function formatAddressLabel(parts: AddressParts): string {
  const street =
    parts.house_number && parts.street_name
      ? `${parts.house_number} ${parts.street_name}`
      : parts.address || '';

  const fallbackFromFormatted = (parts.formatted || '').split(',')[0] || '';
  const rawLabel = compactWhitespace(street || fallbackFromFormatted || 'Unknown Address');
  return truncate(rawLabel, 64);
}

function toUpperLettersAndNumbers(input: string): string {
  return input.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function buildCenterLines(addressLabel: string): { numberLine: string; streetLine: string } {
  const normalized = compactWhitespace(addressLabel);
  if (!normalized) return { numberLine: 'HOME', streetLine: 'ADDRESS' };

  const cleaned = normalized.replace(/,/g, ' ');
  const leadingNumberMatch = cleaned.match(/^(\d+[a-z]?)/i);
  const firstDigitToken = cleaned.split(/\s+/).find((token) => /\d/.test(token));

  const numberRaw = leadingNumberMatch?.[1] || firstDigitToken || '';
  const numberLine = truncate(toUpperLettersAndNumbers(numberRaw), 6) || 'HOME';

  const remainder = leadingNumberMatch ? cleaned.slice(leadingNumberMatch[0].length) : cleaned;
  const streetCandidates = remainder
    .split(/[\s-]+/)
    .map((token) => toUpperLettersAndNumbers(token))
    .filter((token) => token.length > 0 && /[A-Z]/.test(token));
  const streetRaw = streetCandidates[0] || 'ADDRESS';
  const streetLine = truncate(streetRaw, STREET_MAX_CHARS) || 'ADDRESS';

  return { numberLine, streetLine };
}

function buildCenterOverlaySvg(size: number, numberLine: string, streetLine: string): Buffer {
  const badgeWidth = Math.min(CENTER_BADGE_MAX_WIDTH, Math.max(CENTER_BADGE_MIN_WIDTH, 150));
  const x = Math.round((size - badgeWidth) / 2);
  const y = Math.round((size - CENTER_BADGE_HEIGHT) / 2) - 1;
  const rx = 13;

  const renderBitmapLine = (line: string, startX: number, startY: number, scale: number): string => {
    const safeLine = line.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const rects: string[] = [];
    const charAdvance = (GLYPH_COLS + GLYPH_GAP) * scale;
    let cursorX = startX;

    for (const ch of safeLine) {
      const glyph = BITMAP_FONT[ch] || BITMAP_FONT.A;
      for (let row = 0; row < GLYPH_ROWS; row += 1) {
        const rowData = glyph[row] || '00000';
        for (let col = 0; col < GLYPH_COLS; col += 1) {
          if (rowData[col] === '1') {
            rects.push(
              `<rect x="${cursorX + col * scale}" y="${startY + row * scale}" width="${scale}" height="${scale}" fill="#111111" />`
            );
          }
        }
      }
      cursorX += charAdvance;
    }
    return rects.join('');
  };

  const numberScale = 2;
  const streetScale = 2;
  const numberWidth = numberLine.length * (GLYPH_COLS + GLYPH_GAP) * numberScale;
  const streetWidth = streetLine.length * (GLYPH_COLS + GLYPH_GAP) * streetScale;
  const numberX = x + Math.max(10, Math.floor((badgeWidth - numberWidth) / 2));
  const streetX = x + Math.max(10, Math.floor((badgeWidth - streetWidth) / 2));
  const numberY = y + 12;
  const streetY = y + 44;
  const topLineRects = renderBitmapLine(numberLine, numberX, numberY, numberScale);
  const bottomLineRects = renderBitmapLine(streetLine, streetX, streetY, streetScale);

  const svg = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${x}" y="${y}" width="${badgeWidth}" height="${CENTER_BADGE_HEIGHT}" rx="${rx}" fill="#FFFFFF" opacity="0.94"/>
      <rect x="${x}" y="${y}" width="${badgeWidth}" height="${CENTER_BADGE_HEIGHT}" rx="${rx}" fill="none" stroke="#000000" stroke-opacity="0.18" stroke-width="1"/>
      ${topLineRects}
      ${bottomLineRects}
    </svg>
  `;

  return Buffer.from(svg);
}

export async function createPrintableQrPng(qrPngBuffer: Buffer, label: string): Promise<Buffer> {
  const targetSize = DEFAULT_QR_SIZE;
  const normalizedQr = await sharp(qrPngBuffer)
    .resize({ width: targetSize, height: targetSize, fit: 'cover', position: 'centre' })
    .png()
    .toBuffer();

  const { numberLine, streetLine } = buildCenterLines(label);
  const centerOverlay = buildCenterOverlaySvg(targetSize, numberLine, streetLine);
  return sharp(normalizedQr)
    .composite([{ input: centerOverlay, top: 0, left: 0 }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}
