import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/server';
import { crmRequest, requireCrmWorkspace, readCrmBody, privateJson, errorResponse, CrmRequestError } from '@/lib/mac-companion/server';
import { decryptAiKey } from '@/lib/crm-ai/keys';
import {clientGmailContext} from '@/lib/coco/gmail';
import { boundedAiContext, crmAiInstructions, aiAnswerSchema } from '@/lib/crm-ai/context';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const input = z.object({ draftText:z.string().max(10000).optional(),includeGmail:z.boolean().default(false), workspaceId: z.string().uuid(), contactId: z.string().uuid().optional(), question: z.string().trim().min(2).max(1200), mode: z.enum(['question','summarize','follow-up','draft']).default('question'), after: z.string().datetime().optional(), before: z.string().datetime().optional(), historyRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(), history: z.array(z.object({ role: z.enum(['user','assistant']), content: z.string().max(2000) }).strict()).max(6).default([]) }).strict();
export async function POST(request: NextRequest) {
  let usageId: string | undefined;
  let admin: ReturnType<typeof createAdminClient> | undefined;
  let ownerId: string | undefined;
  try {
    const { api, user } = await crmRequest(request, 'ai', true); ownerId = user.id;
    const parsed = input.safeParse(await readCrmBody(request, 20000));
    if (!parsed.success) throw new CrmRequestError('Invalid assistant request.');
    const body = parsed.data;
    if (body.after && body.before && Date.parse(body.after) > Date.parse(body.before)) throw new CrmRequestError('The date range is invalid.');
    await requireCrmWorkspace(api, body.workspaceId);
    const model = process.env.CRM_AI_MODEL;
    if (!model) throw new CrmRequestError('The CRM assistant model is not configured yet.', 503);
    admin = createAdminClient();
    const savedKey = await admin.from('crm_ai_connections').select('encrypted_key,version').eq('user_id', user.id).eq('workspace_id', body.workspaceId).maybeSingle();
    if (savedKey.error || !savedKey.data) throw new CrmRequestError('Connect your OpenAI API key in Integrations.', 403);
    const key = decryptAiKey(savedKey.data.encrypted_key, user.id, body.workspaceId);
    const reserved = await api.rpc('reserve_crm_ai_request', { ws: body.workspaceId, ai_model: model });
    if (reserved.error) throw new CrmRequestError(reserved.error.code === 'P0003' ? 'You have reached 30 AI requests this hour. Try again later.' : 'Could not check AI usage.', reserved.error.code === 'P0003' ? 429 : 503);
    usageId = reserved.data;
    const retrieved = await api.rpc('crm_ai_context', { ws: body.workspaceId, question: body.question, selected_contact: body.contactId ?? null, after_date: body.after ?? null, before_date: body.before ?? null });
    if (retrieved.error) throw new CrmRequestError('Could not load your CRM context.', 503);
    const { context, sources } = boundedAiContext(retrieved.data);
    const messagesIncluded = sources.some(source => source.id.startsWith('message:'));
    async function verifyCurrent() {
      await requireCrmWorkspace(api, body.workspaceId);
      const [pref, currentKey] = await Promise.all([
        api.from('mac_crm_preferences').select('revision').eq('user_id', user.id).eq('workspace_id', body.workspaceId).maybeSingle(),
        admin!.from('crm_ai_connections').select('version').eq('user_id', user.id).eq('workspace_id', body.workspaceId).maybeSingle(),
      ]);
      if (pref.error || currentKey.error || (pref.data?.revision ?? 0) !== context.consentRevision || currentKey.data?.version !== savedKey.data!.version) throw new CrmRequestError('Your consent or OpenAI connection changed. Please ask again.', 409);
      if (body.contactId) {
        const c = await api.from('contacts').select('id').eq('id', body.contactId).eq('user_id', user.id).eq('workspace_id', body.workspaceId).maybeSingle();
        if (c.error || !c.data) throw new CrmRequestError('Contact access changed.', 403);
      }
    }
    await verifyCurrent();
    let gmailContext='';
    if(body.includeGmail){if(!body.contactId)throw new CrmRequestError('Select a contact for Gmail context.');const contact=await api.from('contacts').select('email').eq('id',body.contactId).eq('user_id',user.id).eq('workspace_id',body.workspaceId).maybeSingle();if(!contact.data?.email)throw new CrmRequestError('This contact has no email.');gmailContext=await clientGmailContext(user.id,contact.data.email);await verifyCurrent();}
    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, cache: 'no-store', signal: AbortSignal.any([request.signal, AbortSignal.timeout(60000)]), body: JSON.stringify({ model, store: false, max_output_tokens: 1800, instructions: crmAiInstructions, text: { format: { type: 'json_schema', name: 'crm_answer', strict: true, schema: { type: 'object', properties: { answer: { type: 'string' }, sourceIds: { type: 'array', items: { type: 'string' } }, draft: { type: ['string','null'] } }, required: ['answer','sourceIds','draft'], additionalProperties: false } } }, input: [{ role: 'user', content: JSON.stringify({ date: new Date().toISOString(), mode: body.mode, question: body.question, unsentDraft:body.draftText??'', recentGmailUntrusted:gmailContext, previousTurns: context.messagesEnabled && body.historyRevision === context.consentRevision ? body.history : [], evidence: sources.map(source => ({ id: source.id, text: source.excerpt })), messagesIncluded, coverage: 'Bounded search results, not an exhaustive review.' }) }] }) });
    } catch { throw new CrmRequestError('The AI request was interrupted. Try again later.', 502); }
    if (!response.ok) throw new CrmRequestError(response.status === 401 ? 'OpenAI rejected your key. Reconnect it in Integrations.' : response.status === 429 ? 'OpenAI reports a usage or quota limit. Check your OpenAI account.' : 'OpenAI could not complete this request.', response.status === 429 ? 429 : 502);
    const result = await response.json();
    if (result.status !== 'completed') throw new CrmRequestError('The AI answer was incomplete. Try a narrower question.', 502);
    const text = (result.output ?? []).flatMap((row: { content?: { type: string; text?: string }[] }) => row.content ?? []).filter((part: { type: string }) => part.type === 'output_text').map((part: { text?: string }) => part.text ?? '').join('');
    const answer = aiAnswerSchema.parse(JSON.parse(text));
    const allowed = new Set(sources.map(source => source.id));
    if (answer.sourceIds.some(id => !allowed.has(id))) throw new CrmRequestError('The AI returned an unsupported source. Try again.', 502);
    await verifyCurrent();
    const logged = await admin.from('crm_ai_usage').update({ status: 'completed', input_tokens: result.usage?.input_tokens ?? 0, output_tokens: result.usage?.output_tokens ?? 0 }).eq('id', usageId).eq('user_id', user.id);
    if (logged.error) throw new CrmRequestError('Could not record AI usage.', 503);
    return privateJson({ answer: answer.answer, draft: answer.draft, sources: sources.filter(source => answer.sourceIds.includes(source.id)), partial: true, consentRevision: context.consentRevision, coverage: 'Based on a bounded selection of your records and relevant messages.', messagesIncluded });
  } catch (error) {
    if (usageId && admin && ownerId) await admin.from('crm_ai_usage').update({ status: 'failed', error_code: error instanceof CrmRequestError ? `http_${error.status}` : 'provider_response_invalid' }).eq('id', usageId).eq('user_id', ownerId);
    return errorResponse(error instanceof z.ZodError || error instanceof SyntaxError ? new CrmRequestError('The AI response could not be processed. Try again.', 502) : error);
  }
}
