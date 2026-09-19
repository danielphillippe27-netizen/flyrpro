import { getSupabaseUrl } from '@/lib/supabase/env';
import { vcard, type CardContent } from './contracts';
import { CARD_IMAGE_LIMIT } from './images';

export async function contactDownload(card: CardContent): Promise<string> {
 let photo: string | undefined;
 if (card.photo) {
  try {
   const url = new URL(card.photo);
   // Only fetch our public storage. External photo links remain URI properties.
   if (url.origin === new URL(getSupabaseUrl()).origin && url.pathname.startsWith('/storage/v1/object/public/')) {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok || !response.body || Number(response.headers.get('content-length')) > CARD_IMAGE_LIMIT) throw new Error('Photo unavailable');
    const chunks: Uint8Array[] = []; let length = 0;
    const reader = response.body.getReader();
    try {
     while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      length += chunk.length;
      if (length > CARD_IMAGE_LIMIT) throw new Error('Photo too large');
      chunks.push(chunk);
     }
    } finally {
     await reader.cancel().catch(() => {});
     reader.releaseLock();
    }
    const { default: sharp } = await import('sharp');
    const jpeg = await sharp(Buffer.concat(chunks), { limitInputPixels: 40_000_000, animated: false })
     .rotate().resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
     .flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();
    photo = jpeg.toString('base64');
   }
  } catch {
   // Keep name/contact information downloadable if the photo is temporarily unavailable.
  }
 }
 return vcard(card, photo);
}
