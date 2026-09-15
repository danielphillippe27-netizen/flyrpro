import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/supabase/env';
import { createAdminClient } from '@/lib/supabase/server';
import { contextSchema, requestSchema, recommendation, fingerprint, outputSchema, validateReply, prompt } from '@/lib/wolfy/coach';

export const runtime = 'nodejs';
export const maxDuration = 30;
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function POST(req: NextRequest) {
  if (Number(req.headers.get('content-length') || 0) > 12000) return json({ error: 'Request too large' }, 413);
  const token = req.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!token) return json({ error: 'Sign in required' }, 401);
  try {
    const client = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
      global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await client.auth.getUser(token);
    if (authError || !user) return json({ error: 'Sign in required' }, 401);
    const raw = await req.text();
    if (raw.length > 12000) return json({ error: 'Request too large' }, 413);
    let body;
    try { body = requestSchema.parse(JSON.parse(raw)); } catch { return json({ error: 'Invalid coaching request' }, 400); }
    try { new Intl.DateTimeFormat('en', { timeZone: body.timezone }); } catch { return json({ error: 'Invalid timezone' }, 400); }
    const { data: membership, error: membershipError } = await client.from('workspace_members').select('workspace_id').eq('workspace_id', body.workspaceId).eq('user_id', user.id).limit(1);
    if (membershipError) return json({ error: 'Workspace verification unavailable' }, 503);
    if (!membership?.length) return json({ error: 'Workspace access required' }, 403);
    const { data, error } = await client.rpc('wolfy_coach_context', { p_workspace: body.workspaceId, p_timezone: body.timezone });
    const parsed = contextSchema.safeParse(data);
    if (error || !parsed.success) return json({ error: 'Synced coaching data unavailable' }, 503);
    const context = parsed.data;
    const fixed = recommendation(context);
    const base = { ...fixed, facts: context, source: 'rules', reason: 'ai_unavailable' };
    if (!process.env.OPENAI_API_KEY) return json(base);
    try {
      const admin = createAdminClient();
      const key = fingerprint(context);
      if (body.mode === 'brief') {
        const { data: cache, error: cacheError } = await admin.from('wolfy_coach_cache').select('fingerprint,message,generated_at').eq('user_id', user.id).eq('workspace_id', body.workspaceId).maybeSingle();
        if (cacheError) return json(base); // Fail closed on missing cost-control storage.
        if (cache?.fingerprint === key && Date.now() - Date.parse(cache.generated_at) < 15 * 60 * 1000) {
          return json({ ...base, message: validateReply(JSON.stringify({ message: cache.message })), recommendation: fixed.message, source: 'ai', reason: 'cached' });
        }
        if (cache && Date.now() - Date.parse(cache.generated_at) < 60 * 1000) return json({ ...base, reason: 'cooldown' });
      }
      const { data: reserved, error: budgetError } = await admin.rpc('wolfy_coach_reserve', { p_user: user.id });
      if (budgetError || reserved !== true) return json({ ...base, reason: 'limit' });
      const ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 18000, maxRetries: 0 });
      const response = await ai.responses.create({
        model: 'gpt-5-nano', store: false, reasoning: { effort: 'minimal' }, max_output_tokens: 1000,
        ...prompt(context, body), text: { format: { type: 'json_schema', name: 'wolfy_coaching', strict: true, schema: outputSchema } },
      });
      if (response.status !== 'completed') return json(base);
      const message = validateReply(response.output_text);
      if (body.mode === 'brief') await admin.from('wolfy_coach_cache').upsert({ user_id: user.id, workspace_id: body.workspaceId, fingerprint: key, message, generated_at: new Date().toISOString() });
      return json({ ...base, message, recommendation: fixed.message, source: 'ai', reason: 'generated' });
    } catch { return json(base); }
  } catch { return json({ error: 'Coaching temporarily unavailable' }, 503); }
}
