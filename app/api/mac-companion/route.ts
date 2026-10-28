import { NextRequest } from 'next/server';
import { z } from 'zod';
import { crmRequest, requireCrmWorkspace, readCrmBody, privateJson, errorResponse, CrmRequestError } from '@/lib/mac-companion/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const uuid = z.string().uuid();
const message = z.object({ rowID: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), guid: z.string().min(1).max(256), participants: z.array(z.string().max(256)).length(1), direction: z.enum(['incoming', 'outgoing']), body: z.string().max(100000).nullable(), bodyStatus: z.enum(['decoded', 'unsupported', 'empty']), service: z.string().max(32).nullable(), sentAt: z.string().datetime().nullable(), hasAttachments: z.boolean() }).strict();
const apple = { workspaceId: uuid, phones: z.array(z.string().max(256)).max(100), emails: z.array(z.string().max(256)).max(100), fullName: z.string().trim().min(1).max(200) };
const mutation = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preferences'), workspaceId: uuid, syncEnabled: z.boolean(), aiMessagesEnabled: z.boolean() }).strict(),
  z.object({ action: z.literal('manifest'), workspaceId: uuid, deviceId: uuid }).strict(),
  z.object({ action: z.literal('recheck'), workspaceId: uuid }).strict(),
  z.object({ action: z.literal('sync'), workspaceId: uuid, deviceId: uuid, contactId: uuid, cursor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), messages: z.array(message).max(100) }).strict(),
  z.object({ action: z.literal('review-contact'), ...apple }).strict(),
  z.object({ action: z.literal('import-contact'), ...apple, deviceId: uuid, externalId: z.string().min(1).max(512), phone: z.string().max(256), email: z.string().max(256), targetId: uuid.nullable() }).strict(),
  z.object({ action: z.literal('device-status'), workspaceId: uuid, deviceId: uuid, status: z.enum(['idle','connected','syncing','paused','permission_required','schema_changed','offline','authentication_required','error']) }).strict(),
]);
export async function GET(request: NextRequest) {
  try {
    const { api, user } = await crmRequest(request, 'mac');
    const params = request.nextUrl.searchParams;
    const ws = uuid.parse(params.get('workspaceId'));
    await requireCrmWorkspace(api, ws);
    const contactId = params.get('contactId');
    if (contactId) {
      uuid.parse(contactId);
      const messageId = params.get('messageId');
      if (messageId) uuid.parse(messageId);
      const offset = z.coerce.number().int().min(0).max(1_000_000).parse(params.get('offset') ?? 0);
      const contact = await api.from('contacts').select('id').eq('id', contactId).eq('user_id', user.id).eq('workspace_id', ws).maybeSingle();
      if (contact.error || !contact.data) throw new CrmRequestError('Contact unavailable.', 404);
      const [history, state] = await Promise.all([
        (() => { let query = api.from('mac_contact_messages').select('id,direction,body,body_status,service,sent_at,has_attachments').eq('user_id', user.id).eq('contact_id', contactId); if (messageId) query = query.eq('id', messageId); return query.order('sent_at', { ascending: false, nullsFirst: false }).order('id').range(offset, offset + 99); })(),
        api.from('mac_contact_sync').select('last_sync_at').eq('user_id', user.id).eq('contact_id', contactId).order('last_sync_at', { ascending: false, nullsFirst: false }).limit(1),
      ]);
      if (history.error || state.error) throw new CrmRequestError('Private history is unavailable.', 503);
      return privateJson({ messages: history.data, more: history.data.length === 100, lastSyncAt: state.data[0]?.last_sync_at ?? null });
    }
    const [pref, devices] = await Promise.all([
      api.from('mac_crm_preferences').select('sync_enabled,ai_messages_enabled,revision,sync_consent_at,ai_consent_at').eq('user_id', user.id).eq('workspace_id', ws).maybeSingle(),
      api.from('mac_crm_devices').select('device_id,status,last_seen_at').eq('user_id', user.id).eq('workspace_id', ws).order('last_seen_at', { ascending: false }).limit(10),
    ]);
    if (pref.error || devices.error) throw new CrmRequestError('The Mac CRM database update is required.', 503);
    return privateJson({ userId: user.id, preferences: pref.data ?? { sync_enabled: false, ai_messages_enabled: false, revision: 0 }, devices: devices.data });
  } catch (error) { return errorResponse(error instanceof z.ZodError ? new CrmRequestError('Invalid selection.') : error); }
}
export async function POST(request: NextRequest) {
  try {
    const { api } = await crmRequest(request, 'mac', true);
    const body = mutation.parse(await readCrmBody(request));
    await requireCrmWorkspace(api, body.workspaceId);
    let result;
    switch (body.action) {
      case 'preferences': result = await api.rpc('set_mac_crm_preferences', { ws: body.workspaceId, sync_active: body.syncEnabled, ai_active: body.aiMessagesEnabled }); break;
      case 'manifest': result = await api.rpc('prepare_mac_crm_sync', { ws: body.workspaceId, device: body.deviceId }); break;
      case 'recheck': result = await api.rpc('recheck_mac_crm_history', { ws: body.workspaceId }); break;
      case 'sync': {
        const contact = await api.from('contacts').select('id').eq('id', body.contactId).eq('workspace_id', body.workspaceId).maybeSingle();
        if (!contact.data || contact.error) throw new CrmRequestError('Contact unavailable.', 403);
        result = await api.rpc('import_mac_contact_messages', { target_device: body.deviceId, target_contact: body.contactId, expected_cursor: body.cursor, batch: body.messages }); break;
      }
      case 'review-contact': result = await api.rpc('review_apple_contact', { ws: body.workspaceId, phones: body.phones, emails: body.emails, person_name: body.fullName }); break;
      case 'import-contact': result = await api.rpc('import_apple_contact', { ws: body.workspaceId, device: body.deviceId, external: body.externalId, person_name: body.fullName, phones: body.phones, emails: body.emails, primary_phone: body.phone, primary_email: body.email, target: body.targetId }); break;
      case 'device-status': result = await api.rpc('report_mac_crm_device', { ws: body.workspaceId, device: body.deviceId, device_status: body.status }); break;
    }
    if (result.error) throw new CrmRequestError(result.error.code === '40001' ? 'Sync progress changed. Retrying from saved progress.' : 'Could not save this operation. Review consent, contact matches, and permissions.', result.error.code === '40001' ? 409 : result.error.code === '42501' ? 403 : 400);
    return privateJson(result.data ?? { ok: true });
  } catch (error) { return errorResponse(error instanceof z.ZodError ? new CrmRequestError('Invalid Mac CRM request.') : error); }
}
