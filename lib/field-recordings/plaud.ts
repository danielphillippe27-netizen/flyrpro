import { z } from 'zod';

const tokenSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().int().positive() });
const hosts = ['https://platform-us.plaud.ai', 'https://platform-eu.plaud.ai'];
export function plaudBaseUrl() {
  const host = process.env.PLAUD_BASE_URL || hosts[0];
  if (!hosts.includes(host)) throw new Error('Unsupported PLAUD region');
  return `${host}/developer/api`;
}

async function providerJson(path: string, headers: Record<string, string>, body?: unknown) {
  const response = await fetch(`${plaudBaseUrl()}${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000), cache: 'no-store', redirect: 'error',
  });
  if (!response.ok) throw new Error(`PLAUD request failed (${response.status})`);
  return response.json();
}

export async function issuePlaudUserToken(userId: string) {
  const client = process.env.PLAUD_CLIENT_ID;
  const secret = process.env.PLAUD_SECRET_KEY;
  if (!client || !secret) throw new Error('PLAUD device access is not configured');
  const partnerResponse = await fetch(`${plaudBaseUrl()}/oauth/partner/access-token`, {
    method: 'POST', headers: {
      Authorization: `Basic ${Buffer.from(`${client}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    }, signal: AbortSignal.timeout(30000), cache: 'no-store', redirect: 'error',
  });
  if (!partnerResponse.ok) throw new Error(`PLAUD authentication failed (${partnerResponse.status})`);
  const partner = tokenSchema.parse(await partnerResponse.json());
  return tokenSchema.parse(await providerJson('/open/partner/users/access-token', { Authorization: `Bearer ${partner.access_token}` }, {
    user_id: userId, expires_in: 3600,
  }));
}

function transcriptionHeaders() {
  const client = process.env.PLAUD_CLIENT_ID;
  const key = process.env.PLAUD_API_KEY;
  if (!client || !key) throw new Error('PLAUD transcription is not configured');
  return { 'X-Client-Id': client, 'X-Client-Api-Key': key };
}

export async function submitPlaudTranscription(downloadUrl: string) {
  return z.object({ transcription_id: z.string().min(1), status: z.string() }).parse(await providerJson('/open/partner/ai/transcriptions/', transcriptionHeaders(), {
    file_url: downloadUrl, params: { transcribe: { language: 'auto' }, diarization: { enabled: true }, vad: { decode_silence: false } },
  }));
}

export async function getPlaudTranscription(id: string) {
  return z.object({ status: z.enum(['PENDING', 'RECEIVED', 'STARTED', 'PROGRESS', 'SUCCESS', 'FAILURE', 'REVOKED']), data: z.unknown().optional() }).parse(
    await providerJson(`/open/partner/ai/transcriptions/${encodeURIComponent(id)}`, transcriptionHeaders()),
  );
}

export const plaudUploadSchema = z.object({
  FileId: z.string().min(1), UploadId: z.string().min(1), ChunkSize: z.number().int().min(1).max(16777216),
  Parts: z.array(z.object({ PartNumber: z.number().int().positive(), PresignedUrl: z.url() })).min(1).max(1024),
});
export type PlaudUpload = z.infer<typeof plaudUploadSchema>;
export async function createPlaudUpload(token: string, bytes: number) {
  return plaudUploadSchema.parse(await providerJson('/open/partner/files/upload/generate-presigned-urls', { Authorization: `Bearer ${token}` }, { filesize: bytes, filetype: 'mp3' }));
}
export async function completePlaudUpload(token: string, upload: PlaudUpload, parts: { PartNumber: number; ETag: string }[]) {
  return z.object({ FileId: z.string(), DownloadUrl: z.url() }).parse(await providerJson('/open/partner/files/upload/complete-upload', { Authorization: `Bearer ${token}` }, {
    file_id: upload.FileId, upload_id: upload.UploadId, part_list: parts, filetype: 'mp3',
  }));
}

/** Only follow HTTPS S3 upload URLs issued by PLAUD, without forwarding app credentials. */
export function validatePlaudStorageUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !url.hostname.endsWith('.amazonaws.com')) throw new Error('Invalid PLAUD storage URL');
  return url.toString();
}
