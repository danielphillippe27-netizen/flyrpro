import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/server';

export function gmailConfig() {
  const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GMAIL_OAUTH_REDIRECT_URI;
  const secret = process.env.OUTREACH_ENCRYPTION_KEY;
  if (!clientId || !clientSecret || !redirectUri || !secret || secret.length < 32) throw new Error('Gmail connection setup is not available yet.');
  if (!redirectUri.startsWith('https://')) throw new Error('Gmail requires a secure callback URL.');
  return { clientId, clientSecret, redirectUri, secret };
}
export function seal(value: unknown): string {
  const key = createHash('sha256').update(gmailConfig().secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
export function unseal<T>(value: string): T {
  const key = createHash('sha256').update(gmailConfig().secret).digest();
  const buffer = Buffer.from(value, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12));
  decipher.setAuthTag(buffer.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString());
}
export type GmailTokens = { accessToken: string; refreshToken: string; expiresAt: number; scopes?: string[] };
export async function googleToken(params: Record<string, string>) {
  const config = gmailConfig();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, client_id: config.clientId, client_secret: config.clientSecret }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('Google authorization failed. Reconnect your Gmail account.');
  return await response.json() as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
}
export async function gmailAccess(userId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.from('personal_gmail_connections').select('email,tokens_encrypted').eq('user_id', userId).maybeSingle();
  if (error) throw new Error('Unable to load Gmail connection.');
  if (!data) throw new Error('Connect your Gmail account first.');
  let tokens = unseal<GmailTokens>(data.tokens_encrypted);
  if (tokens.expiresAt < Date.now() + 60_000) {
    const refreshed = await googleToken({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken });
    tokens = { accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token || tokens.refreshToken, expiresAt: Date.now() + refreshed.expires_in * 1000, scopes: refreshed.scope?.split(' ') ?? tokens.scopes };
    const { error: saveError } = await admin.from('personal_gmail_connections').update({ tokens_encrypted: seal(tokens), updated_at: new Date().toISOString() }).eq('user_id', userId);
    if (saveError) throw new Error('Unable to refresh Gmail connection.');
  }
  return { email: data.email as string, token: tokens.accessToken };
}
export function gmailMime(from: string, to: string, subject: string, body: string): string {
  if (/[\r\n]/.test(from + to)) throw new Error('Invalid email address.');
  const encodedBody = Buffer.from(body).toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? '';
  const words: string[] = [];
  let chunk = '';
  for (const character of subject) {
    if (Buffer.byteLength(chunk + character) > 42) { words.push(chunk); chunk = ''; }
    chunk += character;
  }
  if (chunk) words.push(chunk);
  const encodedSubject = words.map(word => `=?UTF-8?B?${Buffer.from(word).toString('base64')}?=`).join('\r\n ');
  const raw = [`From: ${from}`, `To: ${to}`, `Subject: ${encodedSubject}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', encodedBody].join('\r\n');
  return Buffer.from(raw).toString('base64url');
}
