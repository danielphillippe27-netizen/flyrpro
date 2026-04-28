import type { Contact } from '@/types/database';
import type {
  LegacySmartList,
  SmartListBaseKind,
  SmartListCriteria,
  SmartListKind,
  WorkspaceSmartList,
} from '@/types/smart-lists';

export interface SmartListOption {
  id: string;
  name: string;
  kind: SmartListKind;
  description: string;
  isCustom?: boolean;
  criteria?: SmartListCriteria;
}

export const BUILT_IN_SMART_LISTS: SmartListOption[] = [
  {
    id: 'all',
    name: 'All Leads',
    kind: 'all',
    description: 'Everything in your current workspace lead list.',
  },
  {
    id: 'campaign',
    name: 'Campaign',
    kind: 'campaign',
    description: 'Leads tied to campaign outreach or campaign-tagged sources.',
  },
  {
    id: 'farm',
    name: 'Farm',
    kind: 'farm',
    description: 'Leads connected to a farm or tagged as farm outreach.',
  },
  {
    id: 'networking',
    name: 'Networking',
    kind: 'networking',
    description: 'Referral and networking leads sourced from your relationships.',
  },
];

function normalizeToken(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function splitContactTags(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function matchesSource(contact: Contact, source: string): boolean {
  const normalizedSource = normalizeToken(source);
  if (!normalizedSource) return true;
  return normalizeToken(contact.source).includes(normalizedSource);
}

function matchesTags(contact: Contact, tags: string[]): boolean {
  if (tags.length === 0) return true;
  const contactTags = new Set(splitContactTags(contact.tags).map((tag) => normalizeToken(tag)));
  return tags.some((tag) => contactTags.has(normalizeToken(tag)));
}

function matchesCampaignLead(contact: Contact): boolean {
  return Boolean(contact.campaign_id) || normalizeToken(contact.source).includes('campaign');
}

function matchesFarmLead(contact: Contact): boolean {
  return Boolean(contact.farm_id) || normalizeToken(contact.source).includes('farm');
}

function matchesNetworkingLead(contact: Contact): boolean {
  const haystack = [contact.source, contact.tags, contact.notes].map(normalizeToken).join(' ');
  return haystack.includes('network');
}

function matchesBaseKind(contact: Contact, kind: SmartListBaseKind | 'all'): boolean {
  switch (kind) {
    case 'campaign':
      return matchesCampaignLead(contact);
    case 'farm':
      return matchesFarmLead(contact);
    case 'networking':
      return matchesNetworkingLead(contact);
    case 'custom':
    case 'all':
    default:
      return true;
  }
}

export function matchesSmartList(contact: Contact, smartList: SmartListOption): boolean {
  if (smartList.isCustom && smartList.criteria) {
    if (smartList.criteria.contactIds && smartList.criteria.contactIds.length > 0) {
      return smartList.criteria.contactIds.includes(contact.id);
    }

    if (smartList.criteria.campaignIds && smartList.criteria.campaignIds.length > 0) {
      if (!contact.campaign_id || !smartList.criteria.campaignIds.includes(contact.campaign_id)) {
        return false;
      }
    }

    if (smartList.criteria.farmIds && smartList.criteria.farmIds.length > 0) {
      if (!contact.farm_id || !smartList.criteria.farmIds.includes(contact.farm_id)) {
        return false;
      }
    }

    return (
      matchesBaseKind(contact, smartList.criteria.baseKind) &&
      matchesSource(contact, smartList.criteria.source) &&
      matchesTags(contact, smartList.criteria.tags)
    );
  }

  return matchesBaseKind(contact, smartList.kind);
}

export function filterContactsBySmartList(contacts: Contact[], smartList: SmartListOption): Contact[] {
  return contacts.filter((contact) => matchesSmartList(contact, smartList));
}

export function buildCustomSmartListOption(list: WorkspaceSmartList | LegacySmartList): SmartListOption {
  const details: string[] = [];
  const contactIds = list.criteria.contactIds ?? [];
  const campaignIds = list.criteria.campaignIds ?? [];
  const farmIds = list.criteria.farmIds ?? [];

  if (contactIds.length > 0) {
    details.push(`${contactIds.length} imported lead${contactIds.length === 1 ? '' : 's'}`);
  }
  if (campaignIds.length > 0) {
    details.push(`${campaignIds.length} campaign${campaignIds.length === 1 ? '' : 's'}`);
  }
  if (farmIds.length > 0) {
    details.push(`${farmIds.length} farm${farmIds.length === 1 ? '' : 's'}`);
  }
  if (list.criteria.baseKind !== 'custom') {
    details.push(list.criteria.baseKind);
  }
  if (list.criteria.source.trim()) {
    details.push(`source: ${list.criteria.source.trim()}`);
  }
  if (list.criteria.tags.length > 0) {
    details.push(`tags: ${list.criteria.tags.join(', ')}`);
  }

  return {
    id: list.id,
    name: list.name,
    kind: 'custom',
    description: details.length > 0 ? details.join(' • ') : 'Custom smart list with saved lead filters.',
    isCustom: true,
    criteria: list.criteria,
  };
}

export function buildSmartListSignature(list: { name: string; criteria: SmartListCriteria }): string {
  const normalizedTags = [...list.criteria.tags].map((tag) => normalizeToken(tag)).sort();
  const campaignIds = [...(list.criteria.campaignIds ?? [])].map(normalizeToken).sort();
  const farmIds = [...(list.criteria.farmIds ?? [])].map(normalizeToken).sort();
  const contactIds = [...(list.criteria.contactIds ?? [])].map(normalizeToken).sort();
  return [
    normalizeToken(list.name),
    list.criteria.baseKind,
    normalizeToken(list.criteria.source),
    normalizedTags.join(','),
    campaignIds.join(','),
    farmIds.join(','),
    contactIds.join(','),
  ].join('|');
}

export function normalizeStoredCustomSmartLists(value: unknown): LegacySmartList[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];

    const candidate = item as Partial<LegacySmartList>;
    const id = typeof candidate.id === 'string' ? candidate.id : '';
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
    const createdAt = typeof candidate.createdAt === 'string' ? candidate.createdAt : new Date().toISOString();
    const baseKind = candidate.criteria?.baseKind;
    const validBaseKind: SmartListBaseKind =
      baseKind === 'campaign' || baseKind === 'farm' || baseKind === 'networking' || baseKind === 'custom'
        ? baseKind
        : 'custom';
    const source = typeof candidate.criteria?.source === 'string' ? candidate.criteria.source : '';
    const tags = Array.isArray(candidate.criteria?.tags)
      ? candidate.criteria.tags.map((tag) => String(tag).trim()).filter(Boolean)
      : [];
    const campaignIds = Array.isArray(candidate.criteria?.campaignIds)
      ? candidate.criteria.campaignIds.map((id) => String(id).trim()).filter(Boolean)
      : [];
    const farmIds = Array.isArray(candidate.criteria?.farmIds)
      ? candidate.criteria.farmIds.map((id) => String(id).trim()).filter(Boolean)
      : [];
    const contactIds = Array.isArray(candidate.criteria?.contactIds)
      ? candidate.criteria.contactIds.map((id) => String(id).trim()).filter(Boolean)
      : [];

    if (!id || !name) return [];

    return [
      {
        id,
        name,
        createdAt,
        criteria: {
          baseKind: validBaseKind,
          source,
          tags,
          campaignIds,
          farmIds,
          contactIds,
        },
      },
    ];
  });
}
