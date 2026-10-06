import { createHash } from 'node:crypto';
import { Mp3DurationVerifier } from './mp3-duration';
export async function verifyAudio(url: string, byteCount: number, checksum: string): Promise<number> {
  if (!Number.isInteger(byteCount) || byteCount < 1 || byteCount > 536870912 || !/^[a-f0-9]{64}$/.test(checksum)) throw new Error('Invalid audio manifest');
  const response = await fetch(url, { signal: AbortSignal.timeout(120000), redirect: 'error', cache: 'no-store' });
  if (!response.ok || !response.body) throw new Error('Audio download unavailable');
  const hash = createHash('sha256'), duration = new Mp3DurationVerifier();
  let count = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      count += value.byteLength;
      if (count > byteCount) throw new Error('Audio size mismatch');
      hash.update(value); duration.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  if (count !== byteCount || hash.digest('hex') !== checksum) throw new Error('Audio integrity mismatch');
  return duration.finish();
}
