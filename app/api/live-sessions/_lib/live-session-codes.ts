import { createHash, randomBytes } from 'crypto';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const LIVE_SESSION_CODE_LENGTH = 6;
export const LIVE_SESSION_CODE_TTL_MINUTES = 15;

export function sanitizeLiveSessionCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashLiveSessionCode(code: string): string {
  return createHash('sha256').update(sanitizeLiveSessionCode(code)).digest('hex');
}

export function makeLiveSessionCode(length: number = LIVE_SESSION_CODE_LENGTH): string {
  const bytes = randomBytes(length);
  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += CODE_ALPHABET[bytes[index] % CODE_ALPHABET.length];
  }
  return code;
}
