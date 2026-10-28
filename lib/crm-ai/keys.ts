import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { CrmRequestError } from '@/lib/mac-companion/server';
function encryptionKey(): Buffer {
  const key = Buffer.from(process.env.CRM_AI_ENCRYPTION_KEY ?? '', 'base64');
  if (key.length !== 32) throw new CrmRequestError('Secure OpenAI key storage requires configuration.', 503);
  return key;
}
export function aiStorageConfigured() { try { encryptionKey(); return true; } catch { return false; } }
export function encryptAiKey(value: string, userId: string, workspaceId: string): string {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`${userId}:${workspaceId}:v1`));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url')}`;
}
export function decryptAiKey(value: string, userId: string, workspaceId: string): string {
  try {
    if (!value.startsWith('v1.')) throw new Error();
    const bytes = Buffer.from(value.slice(3), 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), bytes.subarray(0,12));
    decipher.setAAD(Buffer.from(`${userId}:${workspaceId}:v1`)); decipher.setAuthTag(bytes.subarray(12,28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
  } catch { throw new CrmRequestError('Reconnect your OpenAI key.', 503); }
}
