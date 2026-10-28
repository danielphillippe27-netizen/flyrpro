import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@/lib/supabase/server';
export class CrmRequestError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const privateJson = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
export function errorResponse(error: unknown) {
  return privateJson({ error: error instanceof CrmRequestError ? error.message : 'The connection is temporarily unavailable.' }, error instanceof CrmRequestError ? error.status : 503);
}
export async function crmRequest(request: NextRequest, feature: 'mac' | 'ai', mutation = false) {
  const api = await getSupabaseServerClient();
  const { data: { user } } = await api.auth.getUser();
  if (!user) throw new CrmRequestError('Sign in to WolfGrid.', 401);
  const flag = process.env[feature === 'mac' ? 'CRM_MAC_ENABLED' : 'CRM_AI_ENABLED'];
  if (flag === 'false' || (flag !== 'true' && process.env.NODE_ENV === 'production')) throw new CrmRequestError('This feature is not enabled for the pilot yet.', 503);
  const pilot = process.env.CRM_PILOT_USER_IDS?.split(',').map(value => value.trim()).filter(Boolean);
  if (pilot?.length && !pilot.includes(user.id)) throw new CrmRequestError('This feature is currently available to pilot members.', 403);
  if (mutation) {
    if (request.headers.get('x-wolfgrid-user-id') !== user.id) throw new CrmRequestError('Your account changed. Reload this page.', 403);
    const origin = request.headers.get('origin');
    if ((origin && origin !== request.nextUrl.origin) || request.headers.get('sec-fetch-site') === 'cross-site') throw new CrmRequestError('Invalid origin.', 403);
  }
  return { api, user };
}
export async function readCrmBody(request: NextRequest, maximum = 2_000_000): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new CrmRequestError('Request body is required.');
  let length = 0; const chunks: Uint8Array[] = [];
  while (true) {
    const result = await reader.read(); if (result.done) break;
    length += result.value.byteLength;
    if (length > maximum) { await reader.cancel(); throw new CrmRequestError('Request too large.', 413); }
    chunks.push(result.value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new CrmRequestError('Invalid JSON.'); }
}
export async function requireCrmWorkspace(api: Awaited<ReturnType<typeof getSupabaseServerClient>>, workspaceId: string) {
  const { data, error } = await api.rpc('mac_workspace_access', { ws: workspaceId });
  if (error) throw new CrmRequestError('The CRM database update is not installed.', 503);
  if (!data) throw new CrmRequestError('Workspace unavailable.', 403);
}
