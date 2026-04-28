export type SmartListKind = 'all' | 'campaign' | 'farm' | 'networking' | 'custom';
export type SmartListBaseKind = Exclude<SmartListKind, 'all'>;

export interface SmartListCriteria {
  baseKind: SmartListBaseKind;
  tags: string[];
  source: string;
  campaignIds?: string[];
  farmIds?: string[];
  contactIds?: string[];
}

export interface WorkspaceSmartList {
  id: string;
  workspace_id: string;
  created_by_user_id: string;
  name: string;
  criteria: SmartListCriteria;
  created_at: string;
  updated_at: string;
}

export interface LegacySmartList {
  id: string;
  name: string;
  criteria: SmartListCriteria;
  createdAt: string;
}
