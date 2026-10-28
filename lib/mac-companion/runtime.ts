import { macApi, macNative, MacApiError, type MacStatus } from './client';
type NativeMessage = { rowID: number; guid: string; participants: string[]; direction: string; body: string | null; bodyStatus: string; service: string | null; sentAt: string | null; hasAttachments: boolean };
type Manifest = { enabled: boolean; contacts: { id: string; full_name: string; cursor: number; identifiers: string[] }[] };
export function createMacSyncRuntime(workspaceId: string, userId: string) {
  let stopped = false, busy = false, failures = 0, retryAt = 0, offset = 0;
  let controller: AbortController | null = null;
  const valid = () => { if (stopped) throw new Error('stopped'); };
  async function tick() {
    if (stopped || busy || Date.now() < retryAt) return;
    busy = true; controller = new AbortController();
    const signal = controller.signal;
    let deviceId: string | undefined;
    try {
      const native = await macNative<{ deviceId: string; messagesAllowed: boolean; status?: string }>('status'); deviceId = native.deviceId; valid();
      const status = await macApi<MacStatus>(`?workspaceId=${workspaceId}`, undefined, signal); valid();
      if (status.userId !== userId) { stop(); await macNative('invalidate'); return; }
      if (!status.preferences.sync_enabled) {
        await macNative('clear-approval');
        await macApi('', { userId, action: 'device-status', workspaceId, deviceId, status: 'paused' }, signal); return;
      }
      if (!native.messagesAllowed) {
        await macApi('', { userId, action: 'device-status', workspaceId, deviceId, status: native.status === 'schema_changed' ? 'schema_changed' : 'permission_required' }, signal); return;
      }
      const manifest = await macApi<Manifest>('', { userId, action: 'manifest', workspaceId, deviceId }, signal); valid();
      if (!manifest.enabled) return;
      const identifiers = [...new Set(manifest.contacts.flatMap(contact => contact.identifiers))];
      if (!identifiers.length) { failures = 0; await macApi('', { userId, action: 'device-status', workspaceId, deviceId, status: 'idle' }, signal); return; }
      const scan = await macNative<{ identifiers: string[]; scanId: string }>('scan', { identifiers, consent: status.preferences.sync_consent_at ?? '', userId, workspaceId }); valid();
      const available = new Set(scan.identifiers);
      const contacts = manifest.contacts.filter(contact => contact.identifiers.some(handle => available.has(handle)));
      let operations = 0;
      const startOffset = offset;
      // Round-robin contacts and bounded work keep large history imports fair and interruptible.
      for (let visited = 0; visited < contacts.length && operations < 50; visited++) {
        const contact = contacts[(startOffset + visited) % contacts.length];
        let cursor = contact.cursor;
        for (let batchCount = 0; batchCount < 8 && operations < 50; batchCount++) {
          const before = await macApi<MacStatus>(`?workspaceId=${workspaceId}`, undefined, signal); valid();
          if (before.userId !== userId || !before.preferences.sync_enabled || before.preferences.revision !== status.preferences.revision) { await macNative('clear-approval'); return; }
          const messages = await macNative<NativeMessage[]>('read', { identifiers: contact.identifiers, cursor, scanId: scan.scanId }); valid();
          const saved = await macApi<{ cursor: number }>('', { userId, action: 'sync', workspaceId, deviceId, contactId: contact.id, cursor, messages }, signal); valid();
          operations++; cursor = saved.cursor;
          if (messages.length < 100) break;
        }
        offset = (startOffset + visited + 1) % Math.max(1, contacts.length);
      }
      failures = 0; retryAt = 0;
      await macApi('', { userId, action: 'device-status', workspaceId, deviceId, status: 'connected' }, signal);
    } catch (error) {
      if (stopped || signal.aborted) return;
      failures++; retryAt = Date.now() + Math.min(300000, 20000 * 2 ** Math.min(failures - 1, 4));
      const status = error instanceof MacApiError && [401,403].includes(error.status) ? 'authentication_required' : /schema/i.test(String(error)) ? 'schema_changed' : /Messages unavailable|permission|access/i.test(String(error)) ? 'permission_required' : 'offline';
      if (deviceId) await macApi('', { userId, action: 'device-status', workspaceId, deviceId, status }, signal).catch(() => {});
      if (status === 'authentication_required') { stop(); await macNative('invalidate').catch(() => {}); }
    } finally { busy = false; controller = null; }
  }
  function stop() { stopped = true; controller?.abort(); void macNative('clear-approval').catch(() => {}); }
  return { tick, stop };
}
