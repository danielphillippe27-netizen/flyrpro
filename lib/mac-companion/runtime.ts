import { macApi, macNative, MacApiError, type MacStatus } from './client';
type NativeAttachment={guid:string;fileName:string;mimeType:string|null;byteCount:number;status:string;token?:string};
type NativeMessage = { attachments?:NativeAttachment[]; rowID: number; guid: string; participants: string[]; direction: string; body: string | null; bodyStatus: string; service: string | null; sentAt: string | null; hasAttachments: boolean };
type Manifest = { enabled: boolean; contacts: { id: string; full_name: string; cursor: number; identifiers: string[]; importAfter?: string | null }[] };
export function createMacSyncRuntime(workspaceId: string, userId: string) {
  let stopped = false, busy = false, failures = 0, retryAt = 0, offset = 0, nextPollAt = 0;
  let controller: AbortController | null = null;
  const valid = () => { if (stopped) throw new Error('stopped'); };
  async function tick(force = false) {
    if (stopped || busy || (!force && (Date.now() < retryAt || Date.now() < nextPollAt))) return;
    busy = true; controller = new AbortController();
    const signal = controller.signal;
    let deviceId: string | undefined; let agentVersion: string | undefined;
    try {
      const native = await macNative<{ deviceId: string; messagesAllowed: boolean; status?: string; agentVersion?: string; historyRanges?: boolean }>('status'); deviceId = native.deviceId; agentVersion = native.agentVersion; valid();
      const status = await macApi<MacStatus>(`?workspaceId=${workspaceId}`, undefined, signal, userId); valid();
      nextPollAt = Date.now() + Math.max(5, Math.min(60, status.preferences.poll_interval_seconds ?? 5)) * 1000;
      const report = (state: string) => macNative('runtime-state', { status: state }).catch(() => {});
      if (status.userId !== userId) { stop(); await macNative('invalidate'); return; }
      if (!status.preferences.sync_enabled) {
        nextPollAt = Date.now() + 30000; await report('paused');
        await macNative('clear-approval');
        await macApi('', { userId, action: 'device-status', workspaceId, deviceId, agentVersion, status: 'paused' }, signal); return;
      }
      if (!native.messagesAllowed) {
        await report(native.status === 'schema_changed' ? 'schema_changed' : 'permission_required');
        await macApi('', { userId, action: 'device-status', workspaceId, deviceId, agentVersion, status: native.status === 'schema_changed' ? 'schema_changed' : 'permission_required' }, signal); return;
      }
      if (!native.historyRanges) throw new MacApiError('Update WolfGrid for Mac to use contact history permissions.', 426);
      const manifest = await macApi<Manifest>('', { userId, action: 'manifest', workspaceId, deviceId, historyRanges: true }, signal); valid();
      if (!manifest.enabled) return;
      if (manifest.contacts.some(contact => contact.importAfter !== undefined) && !native.historyRanges) throw new MacApiError('Update WolfGrid for Mac to use contact history permissions.', 426);
      await report('syncing');
      const identifiers = [...new Set(manifest.contacts.flatMap(contact => contact.identifiers))];
      if (!identifiers.length) { failures = 0; await report('idle'); await macApi('', { userId, action: 'device-status', workspaceId, deviceId, agentVersion, status: 'idle' }, signal); return; }
      const scan = await macNative<{ identifiers: string[]; scanId: string; latestRows?: Record<string,number> }>('scan', { identifiers, consent: status.preferences.sync_consent_at ?? '', userId, workspaceId }); valid();
      const available = new Set(scan.identifiers);
      const contacts = manifest.contacts.filter(contact => contact.identifiers.some(handle => available.has(handle)));
      let operations = 0;
      const startOffset = offset;
      // Round-robin contacts and bounded work keep large history imports fair and interruptible.
      for (let visited = 0; visited < contacts.length && operations < 50; visited++) {
        const contact = contacts[(startOffset + visited) % contacts.length];
        let cursor = contact.cursor;
        if (scan.latestRows && Math.max(0, ...contact.identifiers.map(handle => scan.latestRows![handle] ?? 0)) <= cursor) continue;
        for (let batchCount = 0; batchCount < 8 && operations < 50; batchCount++) {
          const before = await macApi<MacStatus>(`?workspaceId=${workspaceId}`, undefined, signal, userId); valid();
          if (before.userId !== userId || !before.preferences.sync_enabled || before.preferences.revision !== status.preferences.revision) { await macNative('clear-approval'); return; }
          const page = await macNative<NativeMessage[] | { messages: NativeMessage[]; scannedThrough: number }>('read', { identifiers: contact.identifiers, cursor, scanId: scan.scanId, importAfter: contact.importAfter ?? null }); valid();
          const nativeMessages = Array.isArray(page) ? page : page.messages;
          if((status.preferences as typeof status.preferences & {attachment_sync_enabled?:boolean}).attachment_sync_enabled){
            for(const message of nativeMessages)for(const attachment of message.attachments??[]){
              if(attachment.status!=='pending'||!attachment.token||attachment.byteCount>50*1024*1024)continue;
              const payload={workspaceId,contactId:contact.id,messageGuid:message.guid,guid:attachment.guid,participant:message.participants[0],fileName:attachment.fileName,mimeType:attachment.mimeType,byteCount:attachment.byteCount};
              const attachmentApi=async(action:string)=>{valid();const response=await fetch('/api/coco/attachments',{method:'POST',credentials:'include',cache:'no-store',signal,headers:{'Content-Type':'application/json','x-wolfgrid-user-id':userId},body:JSON.stringify({...payload,action})});const result=await response.json();if(!response.ok)throw new MacApiError(result.error||'Attachment sync interrupted.',response.status);valid();return result;};
              const prepared=await attachmentApi('prepare');if(!prepared.uploaded){await macNative('attachment-upload',{token:attachment.token,url:prepared.url,scanId:scan.scanId});valid();await attachmentApi('complete');}
            }
          }
          const messages=nativeMessages.map(({attachments,...message})=>({...message,...(attachments?{attachments:attachments.map(({token:_token,...file})=>({...file,status:status.preferences.attachment_sync_enabled?file.status:'excluded'}))}:{})}));
          const cursorTo = Array.isArray(page) ? undefined : page.scannedThrough;
          const saved = await macApi<{ cursor: number }>('', { userId, action: 'sync', workspaceId, deviceId, contactId: contact.id, cursor, messages, cursorTo }, signal); valid();
          operations++; cursor = saved.cursor;
          if (messages.length < 100) break;
        }
        offset = (startOffset + visited + 1) % Math.max(1, contacts.length);
      }
      failures = 0; retryAt = 0; await report('connected');
      await macApi('', { userId, action: 'device-status', workspaceId, deviceId, agentVersion, status: 'connected' }, signal);
    } catch (error) {
      if (stopped || signal.aborted) return;
      failures++; retryAt = Date.now() + Math.min(300000, 20000 * 2 ** Math.min(failures - 1, 4));
      let status = error instanceof MacApiError && [401,403].includes(error.status) ? 'authentication_required' : error instanceof MacApiError && error.status === 426 ? 'error' : /operation.*already running/i.test(String(error)) ? 'idle' : /schema/i.test(String(error)) ? 'schema_changed' : /Messages unavailable|permission|access/i.test(String(error)) ? 'permission_required' : 'offline';
      if (status === 'idle') { failures = 0; retryAt = Date.now() + 5000; }
      if (error instanceof MacApiError && error.status === 403) {
        try {
          const current = await macApi<MacStatus>(`?workspaceId=${workspaceId}`, undefined, signal, userId); valid();
          if (current.userId === userId) {
            status = current.preferences.sync_enabled ? 'idle' : 'paused';
            failures = 0; retryAt = Date.now() + 5000;
            await macNative('clear-approval');
          }
        } catch { /* Lost account/workspace access remains an authentication stop. */ }
      }
      await macNative('runtime-state', { status }).catch(() => {});
      if (deviceId) await macApi('', { userId, action: 'device-status', workspaceId, deviceId, agentVersion, status }, signal).catch(() => {});
      if (status === 'authentication_required') { stop(); await macNative('invalidate').catch(() => {}); }
    } finally { busy = false; controller = null; }
  }
  function stop() { stopped = true; controller?.abort(); void macNative('clear-approval').catch(() => {}); }
  return { tick, stop };
}
