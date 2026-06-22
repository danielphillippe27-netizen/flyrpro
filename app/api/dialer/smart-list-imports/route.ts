import { NextRequest, NextResponse } from 'next/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import {
  resolveWorkspaceMembershipForUser,
  type MinimalSupabaseClient,
} from '@/app/api/_utils/workspace';
import { createAdminClient } from '@/lib/supabase/server';
import type { SmartListBaseKind, SmartListCriteria } from '@/types/smart-lists';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ContactRow = {
  id: string;
  user_id?: string | null;
  full_name?: string | null;
  name?: string | null;
  phone?: string | null;
  phone_e164?: string | null;
  email?: string | null;
  address?: string | null;
  source?: string | null;
  tags?: string | null;
  notes?: string | null;
  campaign_id?: string | null;
  farm_id?: string | null;
};

type SmartListRow = {
  id: string;
  name: string;
  criteria?: unknown;
  created_at: string;
};

function clean(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function normalizeToken(value: string | null | undefined): string {
  return clean(value).toLowerCase();
}

function splitTags(value: string | null | undefined): string[] {
  return clean(value)
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizeCriteria(value: unknown): SmartListCriteria {
  const candidate = value && typeof value === 'object' ? (value as Partial<SmartListCriteria>) : {};
  const baseKind = candidate.baseKind;
  const validBaseKind: SmartListBaseKind =
    baseKind === 'campaign' || baseKind === 'farm' || baseKind === 'networking' || baseKind === 'custom'
      ? baseKind
      : 'custom';

  return {
    baseKind: validBaseKind,
    source: typeof candidate.source === 'string' ? candidate.source : '',
    tags: Array.isArray(candidate.tags) ? candidate.tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
    campaignIds: Array.isArray(candidate.campaignIds)
      ? candidate.campaignIds.map((id) => String(id).trim()).filter(Boolean)
      : [],
    farmIds: Array.isArray(candidate.farmIds)
      ? candidate.farmIds.map((id) => String(id).trim()).filter(Boolean)
      : [],
    contactIds: Array.isArray(candidate.contactIds)
      ? candidate.contactIds.map((id) => String(id).trim()).filter(Boolean)
      : [],
  };
}

function matchesBaseKind(contact: ContactRow, kind: SmartListBaseKind | 'all') {
  switch (kind) {
    case 'campaign':
      return Boolean(contact.campaign_id) || normalizeToken(contact.source).includes('campaign');
    case 'farm':
      return Boolean(contact.farm_id) || normalizeToken(contact.source).includes('farm');
    case 'networking': {
      const haystack = [contact.source, contact.tags, contact.notes].map(normalizeToken).join(' ');
      return haystack.includes('network');
    }
    case 'custom':
    case 'all':
    default:
      return true;
  }
}

function matchesCriteria(contact: ContactRow, criteria: SmartListCriteria) {
  if (criteria.contactIds && criteria.contactIds.length > 0) {
    return criteria.contactIds.includes(contact.id);
  }

  if (criteria.campaignIds && criteria.campaignIds.length > 0) {
    if (!contact.campaign_id || !criteria.campaignIds.includes(contact.campaign_id)) return false;
  }

  if (criteria.farmIds && criteria.farmIds.length > 0) {
    if (!contact.farm_id || !criteria.farmIds.includes(contact.farm_id)) return false;
  }

  const normalizedSource = normalizeToken(criteria.source);
  const contactTags = new Set(splitTags(contact.tags).map(normalizeToken));
  const tagsMatch =
    criteria.tags.length === 0 || criteria.tags.some((tag) => contactTags.has(normalizeToken(tag)));

  return (
    matchesBaseKind(contact, criteria.baseKind) &&
    (!normalizedSource || normalizeToken(contact.source).includes(normalizedSource)) &&
    tagsMatch
  );
}

function dialableContacts(contacts: ContactRow[]) {
  return contacts
    .map((contact) => ({
      name: clean(contact.full_name) || clean(contact.name) || 'Lead',
      phone: clean(contact.phone_e164) || clean(contact.phone),
      company: clean(contact.address) || null,
      email: clean(contact.email) || null,
    }))
    .filter((lead) => lead.phone);
}

function describeCriteria(criteria: SmartListCriteria) {
  const details: string[] = [];
  if ((criteria.contactIds ?? []).length > 0) details.push(`${criteria.contactIds?.length} saved leads`);
  if ((criteria.campaignIds ?? []).length > 0) details.push(`${criteria.campaignIds?.length} campaigns`);
  if ((criteria.farmIds ?? []).length > 0) details.push(`${criteria.farmIds?.length} farms`);
  if (criteria.baseKind !== 'custom') details.push(criteria.baseKind);
  if (criteria.source.trim()) details.push(`source: ${criteria.source.trim()}`);
  if (criteria.tags.length > 0) details.push(`tags: ${criteria.tags.join(', ')}`);
  return details.join(' • ') || 'Custom saved lead filters';
}

export async function GET(request: NextRequest) {
  const requestUser = await resolveUserFromRequest(request);
  if (!requestUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const requestedWorkspaceId = request.nextUrl.searchParams.get('workspaceId');
  const admin = createAdminClient();
  const membership = await resolveWorkspaceMembershipForUser(
    admin as unknown as MinimalSupabaseClient,
    requestUser.id,
    requestedWorkspaceId
  );

  if (!membership.workspaceId) {
    return NextResponse.json(
      { error: membership.error ?? 'Workspace not found' },
      { status: membership.status ?? 403 }
    );
  }

  const [contactsResult, smartListsResult] = await Promise.all([
    admin
      .from('contacts')
      .select('id,user_id,full_name,name,phone,phone_e164,email,address,source,tags,notes,campaign_id,farm_id')
      .eq('workspace_id', membership.workspaceId)
      .eq('user_id', requestUser.id)
      .order('created_at', { ascending: false })
      .limit(500),
    admin
      .from('smart_lists')
      .select('id,name,criteria,created_at')
      .eq('workspace_id', membership.workspaceId)
      .eq('created_by_user_id', requestUser.id)
      .order('created_at', { ascending: false }),
  ]);

  if (contactsResult.error) {
    console.error('[dialer/smart-list-imports] failed to load contacts', contactsResult.error);
    return NextResponse.json({ error: 'Failed to load Leads smart lists.' }, { status: 500 });
  }

  const contacts = (contactsResult.data ?? []) as ContactRow[];
  const customLists = smartListsResult.error ? [] : ((smartListsResult.data ?? []) as SmartListRow[]);
  if (smartListsResult.error) {
    console.warn('[dialer/smart-list-imports] smart_lists unavailable', smartListsResult.error);
  }

  const baseLists = [
    {
      id: 'all',
      name: 'All Leads',
      description: 'Everything in your current workspace lead list.',
      contacts,
    },
    {
      id: 'campaign',
      name: 'Campaign',
      description: 'Leads tied to campaign outreach.',
      contacts: contacts.filter((contact) => matchesBaseKind(contact, 'campaign')),
    },
    {
      id: 'farm',
      name: 'Farm',
      description: 'Leads connected to farm outreach.',
      contacts: contacts.filter((contact) => matchesBaseKind(contact, 'farm')),
    },
    {
      id: 'networking',
      name: 'Networking',
      description: 'Referral and networking leads.',
      contacts: contacts.filter((contact) => matchesBaseKind(contact, 'networking')),
    },
  ];

  const lists = [
    ...baseLists,
    ...customLists.map((list) => {
      const criteria = normalizeCriteria(list.criteria);
      return {
        id: list.id,
        name: list.name,
        description: describeCriteria(criteria),
        contacts: contacts.filter((contact) => matchesCriteria(contact, criteria)),
      };
    }),
  ]
    .map((list) => {
      const leads = dialableContacts(list.contacts);
      return {
        id: list.id,
        name: list.name,
        description: list.description,
        count: list.contacts.length,
        dialableCount: leads.length,
        leads,
      };
    })
    .filter((list) => list.count > 0);

  return NextResponse.json({ lists, workspaceId: membership.workspaceId });
}
