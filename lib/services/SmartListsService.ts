import { createClient } from '@/lib/supabase/client';
import type { SmartListBaseKind, SmartListCriteria, WorkspaceSmartList } from '@/types/smart-lists';

type SmartListRow = {
  id: string;
  workspace_id: string;
  created_by_user_id: string;
  name: string;
  criteria?: unknown;
  created_at: string;
  updated_at: string;
};

type CreateWorkspaceSmartListPayload = {
  workspaceId: string;
  createdByUserId: string;
  name: string;
  criteria: SmartListCriteria;
};

export class SmartListsService {
  private static client = createClient();
  private static localIdPrefix = 'local-smart-list:';
  private static localStorageKeyPrefix = 'flyr:crm:local-smart-lists:';

  private static isBrowser(): boolean {
    return typeof window !== 'undefined';
  }

  private static localStorageKey(workspaceId: string): string {
    return `${this.localStorageKeyPrefix}${workspaceId}`;
  }

  private static canFallbackToLocal(error: unknown): boolean {
    const message =
      error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message ?? '').toLowerCase()
        : '';

    return (
      message.includes('smart_lists') ||
      message.includes('smart lists') ||
      message.includes('relation') ||
      message.includes('does not exist') ||
      message.includes('could not find the table') ||
      message.includes('permission denied')
    );
  }

  private static readLocalWorkspaceSmartLists(workspaceId: string): WorkspaceSmartList[] {
    if (!this.isBrowser()) return [];

    try {
      const raw = window.localStorage.getItem(this.localStorageKey(workspaceId));
      if (!raw) return [];
      const parsed = JSON.parse(raw) as SmartListRow[];
      if (!Array.isArray(parsed)) return [];
      return parsed.map((row) => this.normalizeRow(row));
    } catch {
      return [];
    }
  }

  private static writeLocalWorkspaceSmartLists(workspaceId: string, lists: WorkspaceSmartList[]): void {
    if (!this.isBrowser()) return;

    try {
      window.localStorage.setItem(this.localStorageKey(workspaceId), JSON.stringify(lists));
    } catch {
      // Ignore localStorage write failures and preserve app flow.
    }
  }

  static createLocalWorkspaceSmartList(payload: {
    workspaceId: string;
    name: string;
    criteria: SmartListCriteria;
    createdByUserId?: string;
  }): WorkspaceSmartList {
    const existing = this.readLocalWorkspaceSmartLists(payload.workspaceId);
    const now = new Date().toISOString();
    const created: WorkspaceSmartList = {
      id: `${this.localIdPrefix}${crypto.randomUUID()}`,
      workspace_id: payload.workspaceId,
      created_by_user_id: payload.createdByUserId ?? 'local',
      name: payload.name.trim(),
      criteria: this.normalizeCriteria(payload.criteria),
      created_at: now,
      updated_at: now,
    };

    this.writeLocalWorkspaceSmartLists(payload.workspaceId, [created, ...existing]);
    return created;
  }

  private static normalizeCriteria(value: unknown): SmartListCriteria {
    const record = value && typeof value === 'object' ? (value as Partial<SmartListCriteria>) : {};
    const baseKind = record.baseKind;
    const validBaseKind: SmartListBaseKind =
      baseKind === 'campaign' || baseKind === 'farm' || baseKind === 'networking' || baseKind === 'custom'
        ? baseKind
        : 'custom';
    const tags = Array.isArray(record.tags)
      ? record.tags.map((tag) => String(tag).trim()).filter(Boolean)
      : [];
    const source = typeof record.source === 'string' ? record.source.trim() : '';
    const campaignIds = Array.isArray(record.campaignIds)
      ? record.campaignIds.map((id) => String(id).trim()).filter(Boolean)
      : [];
    const farmIds = Array.isArray(record.farmIds)
      ? record.farmIds.map((id) => String(id).trim()).filter(Boolean)
      : [];
    const contactIds = Array.isArray(record.contactIds)
      ? record.contactIds.map((id) => String(id).trim()).filter(Boolean)
      : [];

    return {
      baseKind: validBaseKind,
      tags,
      source,
      campaignIds,
      farmIds,
      contactIds,
    };
  }

  private static normalizeRow(row: SmartListRow): WorkspaceSmartList {
    return {
      id: row.id,
      workspace_id: row.workspace_id,
      created_by_user_id: row.created_by_user_id,
      name: row.name,
      criteria: this.normalizeCriteria(row.criteria),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  static async fetchWorkspaceSmartLists(workspaceId: string): Promise<WorkspaceSmartList[]> {
    const localLists = this.readLocalWorkspaceSmartLists(workspaceId);
    const { data, error } = await this.client
      .from('smart_lists')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (error) {
      if (this.canFallbackToLocal(error)) {
        return localLists;
      }
      throw error;
    }

    const remoteLists = (data ?? []).map((row) => this.normalizeRow(row as SmartListRow));
    const seenIds = new Set(remoteLists.map((list) => list.id));
    const merged = [...remoteLists, ...localLists.filter((list) => !seenIds.has(list.id))];
    return merged.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  static async createWorkspaceSmartList(payload: CreateWorkspaceSmartListPayload): Promise<WorkspaceSmartList> {
    const { data, error } = await this.client
      .from('smart_lists')
      .insert({
        workspace_id: payload.workspaceId,
        created_by_user_id: payload.createdByUserId,
        name: payload.name.trim(),
        criteria: payload.criteria,
      })
      .select('*')
      .single();

    if (error) {
      if (this.canFallbackToLocal(error)) {
        return this.createLocalWorkspaceSmartList(payload);
      }
      throw error;
    }
    return this.normalizeRow(data as SmartListRow);
  }

  static async deleteWorkspaceSmartList(id: string, workspaceId?: string): Promise<void> {
    if (id.startsWith(this.localIdPrefix)) {
      if (!workspaceId) return;
      const existing = this.readLocalWorkspaceSmartLists(workspaceId);
      this.writeLocalWorkspaceSmartLists(
        workspaceId,
        existing.filter((list) => list.id !== id)
      );
      return;
    }

    const { error } = await this.client.from('smart_lists').delete().eq('id', id);
    if (error) {
      if (workspaceId && this.canFallbackToLocal(error)) {
        const existing = this.readLocalWorkspaceSmartLists(workspaceId);
        this.writeLocalWorkspaceSmartLists(
          workspaceId,
          existing.filter((list) => list.id !== id)
        );
        return;
      }
      throw error;
    }
  }
}
