import { NextRequest } from 'next/server';
import { z } from 'zod';
import {createAdminClient} from '@/lib/supabase/server';
import { crmRequest, requireCrmWorkspace, readCrmBody, privateJson, errorResponse, CrmRequestError } from '@/lib/mac-companion/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const uuid = z.string().uuid();
const message = z.object({ rowID: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), guid: z.string().min(1).max(256), participants: z.array(z.string().max(256)).length(1), direction: z.enum(['incoming', 'outgoing']), body: z.string().max(100000).nullable(), bodyStatus: z.enum(['decoded', 'unsupported', 'empty']), service: z.string().max(32).nullable(), sentAt: z.string().datetime().nullable(), hasAttachments: z.boolean(),attachments:z.array(z.object({guid:z.string().min(1).max(256),fileName:z.string().min(1).max(512),mimeType:z.string().max(150).nullable(),byteCount:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),status:z.enum(['pending','unavailable','too_large','excluded'])}).strict()).max(100).optional() }).strict();
const apple = { workspaceId: uuid, phones: z.array(z.string().max(256)).max(100), emails: z.array(z.string().max(256)).max(100), fullName: z.string().trim().min(1).max(200) };
const mutation = z.discriminatedUnion('action', [
  z.object({ action: z.literal('enable-contact-sync'), workspaceId: uuid }).strict(),
  z.object({ action: z.literal('preferences'), workspaceId: uuid, syncEnabled: z.boolean(), aiMessagesEnabled: z.boolean() }).strict(),
  z.object({ action: z.literal('contact-permission'), workspaceId: uuid, contactId: uuid, enabled: z.boolean(), identifiers: z.array(z.string().max(256)).max(100), history: z.enum(['future','30d','90d','all']) }).strict(),
  z.object({ action: z.literal('poll-interval'), workspaceId: uuid, seconds: z.number().int().min(5).max(60) }).strict(),
  z.object({ action: z.literal('delete-history'), workspaceId: uuid, contactId: uuid, confirmation: z.literal('DELETE') }).strict(),
  z.object({ action: z.literal('manifest'), workspaceId: uuid, deviceId: uuid, historyRanges: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('recheck'), workspaceId: uuid }).strict(),
  z.object({ action: z.literal('sync'), workspaceId: uuid, deviceId: uuid, contactId: uuid, cursor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), messages: z.array(message).max(100), cursorTo: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional() }).strict(),
  z.object({ action: z.literal('review-contact'), ...apple }).strict(),
  z.object({ action: z.literal('import-contact'), ...apple, deviceId: uuid, externalId: z.string().min(1).max(512), phone: z.string().max(256), email: z.string().max(256), targetId: uuid.nullable(), title: z.string().trim().max(60).optional(), note: z.string().max(4000).optional() }).strict(),
  z.object({ action: z.literal('device-status'), workspaceId: uuid, deviceId: uuid, status: z.enum(['idle','connected','syncing','paused','permission_required','schema_changed','offline','authentication_required','error']), agentVersion: z.string().max(40).optional() }).strict(),
]);
export async function GET(request: NextRequest) {
  try {
    const { api, user } = await crmRequest(request, 'mac');
    const params = request.nextUrl.searchParams;
    const ws = uuid.parse(params.get('workspaceId'));
    await requireCrmWorkspace(api, ws);
    const view = params.get('view');
    if (view) {
      const query = z.string().max(200).parse(params.get('query') ?? '');
      const pageOffset = z.coerce.number().int().min(0).max(1_000_000).parse(params.get('offset') ?? 0);
      const functions = { audit: 'mac_apple_audit', overview: 'mac_apple_overview', contacts: 'mac_apple_contacts', conversations: 'mac_apple_conversations', productivity: 'mac_apple_productivity' } as const;
      if (!(view in functions)) throw new CrmRequestError('Unknown Apple view.');
      const name = functions[view as keyof typeof functions];
      const result = await api.rpc(name, { ws, ...(['contacts','conversations'].includes(view) ? { query, page_offset: pageOffset } : {}) });
      if (result.error) throw new CrmRequestError('The Apple integration update is required.', 503);
      return privateJson(result.data);
    }
    const contactId = params.get('contactId');
    if (contactId) {
      uuid.parse(contactId);
      const messageId = params.get('messageId');
      if (messageId) uuid.parse(messageId);
      const offset = z.coerce.number().int().min(0).max(1_000_000).parse(params.get('offset') ?? 0);
      const before=params.get('before'),beforeId=params.get('beforeId');if(before){z.string().datetime().parse(before);uuid.parse(beforeId);}const beforeNull=params.get('beforeNull')==='true';if(beforeNull)uuid.parse(beforeId);
      const contact = await api.from('contacts').select('id').eq('id', contactId).eq('user_id', user.id).eq('workspace_id', ws).maybeSingle();
      if (contact.error || !contact.data) throw new CrmRequestError('Contact unavailable.', 404);
      const [history, state] = await Promise.all([
        (() => { let query = api.from('mac_contact_messages').select('id,external_id,direction,body,body_status,service,sent_at,has_attachments,attachment_manifest').eq('user_id', user.id).eq('contact_id', contactId); if (messageId) query = query.eq('id', messageId);if(before)query=query.or(`sent_at.lt.${before},and(sent_at.eq.${before},id.lt.${beforeId}),sent_at.is.null`);if(beforeNull)query=query.is('sent_at',null).lt('id',beforeId!);return query.order('sent_at', { ascending: false, nullsFirst: false }).order('id',{ascending:false}).range(offset, offset + 99); })(),
        api.from('mac_contact_sync').select('last_sync_at').eq('user_id', user.id).eq('contact_id', contactId).order('last_sync_at', { ascending: false, nullsFirst: false }).limit(1),
      ]);
      if (history.error || state.error) throw new CrmRequestError('Private history is unavailable.', 503);
      const files=await api.from('crm_message_attachments').select('message_guid,guid,file_name,mime_type,byte_count,status').eq('user_id',user.id).eq('workspace_id',ws).eq('contact_id',contactId).in('message_guid',(history.data??[]).map((m: {external_id?:string})=>m.external_id).filter((v):v is string=>typeof v==='string'));
      const messages=(history.data??[]).map(m=>({...m,attachments:[...(Array.isArray(m.attachment_manifest)?m.attachment_manifest:[]).filter((f:{guid:string})=>!(files.data??[]).some(saved=>saved.message_guid===m.external_id&&saved.guid===f.guid)),...(files.data??[]).filter(f=>f.message_guid===m.external_id).map(f=>({guid:f.guid,fileName:f.file_name,mimeType:f.mime_type,byteCount:f.byte_count,status:f.status}))]}));
      return privateJson({ messages, more: history.data.length === 100, lastSyncAt: state.data[0]?.last_sync_at ?? null });
    }
    const [pref, devices] = await Promise.all([
      api.from('mac_crm_preferences').select('sync_enabled,ai_messages_enabled,revision,sync_consent_at,ai_consent_at,poll_interval_seconds,attachment_sync_enabled').eq('user_id', user.id).eq('workspace_id', ws).maybeSingle(),
      api.from('mac_crm_devices').select('device_id,status,last_seen_at,agent_version').eq('user_id', user.id).eq('workspace_id', ws).order('last_seen_at', { ascending: false }).limit(10),
    ]);
    if (pref.error || devices.error) throw new CrmRequestError('The Mac CRM database update is required.', 503);
    return privateJson({ userId: user.id, preferences: pref.data ?? { sync_enabled: false, ai_messages_enabled: false, revision: 0 }, devices: devices.data });
  } catch (error) { return errorResponse(error instanceof z.ZodError ? new CrmRequestError('Invalid selection.') : error); }
}
export async function POST(request: NextRequest) {
  try {
    const { api,user } = await crmRequest(request, 'mac', true);
    const body = mutation.parse(await readCrmBody(request));
    await requireCrmWorkspace(api, body.workspaceId);
    let result;
    switch (body.action) {
      case 'enable-contact-sync': result = await api.rpc('enable_mac_contact_sync', { ws: body.workspaceId }); break;
      case 'preferences': result = await api.rpc('set_mac_crm_preferences', { ws: body.workspaceId, sync_active: body.syncEnabled, ai_active: body.aiMessagesEnabled }); break;
      case 'contact-permission': result = await api.rpc('set_mac_message_permission', { ws: body.workspaceId, target: body.contactId, active: body.enabled, handles: body.identifiers, history: body.history }); break;
      case 'poll-interval': result = await api.rpc('set_mac_poll_interval', { ws: body.workspaceId, seconds: body.seconds }); break;
      case 'delete-history': {
        const files=await api.from('crm_message_attachments').select('object_key').eq('user_id',user.id).eq('workspace_id',body.workspaceId).eq('contact_id',body.contactId);
        result=await api.rpc('delete_mac_message_history',{ws:body.workspaceId,target:body.contactId,confirmation:body.confirmation});
        if(!result.error&&files.data?.length)await createAdminClient().storage.from('crm-private-message-attachments').remove(files.data.map(f=>f.object_key));break;
      }
      case 'manifest': result = await api.rpc('prepare_mac_crm_sync', { ws: body.workspaceId, device: body.deviceId, history_capable: body.historyRanges ?? false }); break;
      case 'recheck': result = await api.rpc('recheck_mac_crm_history', { ws: body.workspaceId }); break;
      case 'sync': {
        const contact = await api.from('contacts').select('id').eq('id', body.contactId).eq('workspace_id', body.workspaceId).maybeSingle();
        if (!contact.data || contact.error) throw new CrmRequestError('Contact unavailable.', 403);
        result = await api.rpc('import_mac_contact_messages', { target_device: body.deviceId, target_contact: body.contactId, expected_cursor: body.cursor, batch: body.messages, scanned_cursor: body.cursorTo ?? null }); break;
      }
      case 'review-contact': result = await api.rpc('review_apple_contact', { ws: body.workspaceId, phones: body.phones, emails: body.emails, person_name: body.fullName }); break;
      case 'import-contact': result = await api.rpc('import_apple_contact_details', { ws: body.workspaceId, device: body.deviceId, external: body.externalId, person_name: body.fullName, phones: body.phones, emails: body.emails, primary_phone: body.phone, primary_email: body.email, target: body.targetId, contact_title: body.title ?? '', contact_note: body.note ?? '' }); break;
      case 'device-status': result = await api.rpc('report_apple_agent', { ws: body.workspaceId, device: body.deviceId, device_status: body.status, version: body.agentVersion ?? null }); break;
    }
    if (result.error) throw new CrmRequestError(result.error.code === '40001' ? 'Sync progress changed. Retrying from saved progress.' : 'Could not save this operation. Review consent, contact matches, and permissions.', result.error.code === '40001' ? 409 : result.error.code === '42501' ? 403 : 400);
    return privateJson(result.data ?? { ok: true });
  } catch (error) { return errorResponse(error instanceof z.ZodError ? new CrmRequestError('Invalid Mac CRM request.') : error); }
}
