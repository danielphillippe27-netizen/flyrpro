import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/server';
import { crmRequest, requireCrmWorkspace, readCrmBody, privateJson, errorResponse, CrmRequestError } from '@/lib/mac-companion/server';
import { aiStorageConfigured, encryptAiKey } from '@/lib/crm-ai/keys';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function connection(request: NextRequest) {
  try {
    const { api, user } = await crmRequest(request, 'ai', request.method !== 'GET');
    const raw = request.method === 'GET' ? { workspaceId: request.nextUrl.searchParams.get('workspaceId') } : await readCrmBody(request, 4096);
    const body = z.object({ workspaceId: z.string().uuid(), apiKey: z.string().trim().min(20).max(512).optional() }).strict().parse(raw);
    await requireCrmWorkspace(api, body.workspaceId);
    const admin = createAdminClient();
    if (request.method === 'GET') {
      const result = await admin.from('crm_ai_connections').select('updated_at').eq('user_id', user.id).eq('workspace_id', body.workspaceId).maybeSingle();
      if (result.error) throw new CrmRequestError('OpenAI connection storage is unavailable.', 503);
      return privateJson({ connected: !!result.data, updatedAt: result.data?.updated_at, canSave: aiStorageConfigured(), configured: !!process.env.CRM_AI_MODEL });
    }
    if (request.method === 'DELETE') {
      const result = await admin.from('crm_ai_connections').delete().eq('user_id', user.id).eq('workspace_id', body.workspaceId);
      if (result.error) throw new CrmRequestError('Could not disconnect OpenAI.', 503);
      return privateJson({ connected: false });
    }
    if (!body.apiKey || !/^sk-[A-Za-z0-9_-]+$/.test(body.apiKey)) throw new CrmRequestError('Enter a valid OpenAI API key.');
    const encrypted = encryptAiKey(body.apiKey, user.id, body.workspaceId);
    let response: Response;
    try { response = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${body.apiKey}` }, cache: 'no-store', signal: AbortSignal.timeout(15000) }); }
    catch { throw new CrmRequestError('OpenAI could not be reached. Try again.', 502); }
    if (!response.ok) throw new CrmRequestError(response.status === 401 ? 'OpenAI rejected this key.' : 'Could not verify the key. Check its API permissions.', 400);
    const result = await admin.from('crm_ai_connections').upsert({ user_id: user.id, workspace_id: body.workspaceId, encrypted_key: encrypted, version: crypto.randomUUID(), updated_at: new Date().toISOString() });
    if (result.error) throw new CrmRequestError('Could not save the OpenAI connection.', 503);
    return privateJson({ connected: true });
  } catch (error) { return errorResponse(error instanceof z.ZodError ? new CrmRequestError('Invalid connection details.') : error); }
}
export const GET = connection;
export const POST = connection;
export const DELETE = connection;
