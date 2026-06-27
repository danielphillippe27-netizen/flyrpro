'use client';

import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { CampaignsService, type CampaignStats } from '@/lib/services/CampaignsService';
import {
  deriveCampaignStats,
  getAddressRecipientsStatus,
  getCampaignAddressMapStatus,
  isVisitedCampaignAddress,
} from '@/lib/campaignStats';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadingScreen } from '@/components/LoadingScreen';
import { RecipientsTable } from '@/components/RecipientsTable';
import { StatsHeader } from '@/components/StatsHeader';
import { PaywallGuard } from '@/components/PaywallGuard';
import { MissingQRModal } from '@/components/modals/MissingQRModal';
import type { CampaignV2, CampaignAddress, Contact } from '@/types/database';
import type { CampaignRoadMetadata } from '@/types/campaign-roads';
import {
  ArrowRight,
  BarChart3,
  Users,
  MapPin,
  Search,
  Plus,
  Pencil,
  Trash2,
  Paperclip,
  FileText,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { createClient } from '@/lib/supabase/client';
import { useWorkspace } from '@/lib/workspace-context';
import { ActivityPageView } from '@/components/activity/ActivityPageView';
import { CampaignAssignmentView } from '@/components/campaigns/CampaignAssignmentView';
import { FinancePanel } from '@/components/finance/FinancePanel';
import {
  buildLegacyCampaignText,
  isMissingCampaignColumnErrorMessage,
  parseLegacyCampaignText,
} from '@/lib/campaignLegacyFields';
import { useTheme } from '@/lib/theme-provider';

const FLYER_MAX_SIZE_MB = 10;

const MapPanelSkeleton = () => (
  <div className="flex h-full min-h-[400px] items-center justify-center bg-muted/30 text-sm text-muted-foreground">
    Loading map…
  </div>
);

const SectionLoadingSkeleton = ({ label }: { label: string }) => (
  <div className="space-y-3" aria-label={label}>
    <div className="h-4 w-32 animate-pulse rounded bg-muted" />
    <div className="space-y-2">
      <div className="h-10 animate-pulse rounded-md bg-muted/70" />
      <div className="h-10 animate-pulse rounded-md bg-muted/50" />
      <div className="h-10 animate-pulse rounded-md bg-muted/40" />
    </div>
  </div>
);

const InlineSectionError = ({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) => (
  <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm">
    <p className="text-destructive">{message}</p>
    <Button type="button" size="sm" variant="outline" className="mt-3" onClick={onRetry}>
      Retry
    </Button>
  </div>
);

const CampaignDetailMapView = dynamic(
  () =>
    import('@/components/campaigns/CampaignDetailMapView').then((m) => m.CampaignDetailMapView),
  { ssr: false, loading: () => <MapPanelSkeleton /> }
);

import { Textarea } from '@/components/ui/textarea';
import { ContactsService } from '@/lib/services/ContactsService';
import { CreateContactDialog } from '@/components/crm/CreateContactDialog';

type CampaignWithLegacyDescription = CampaignV2 & {
  description?: string | null;
};

const CAMPAIGN_TAB_VALUES = ['map', 'activity', 'addresses', 'contacts', 'qr', 'finance', 'assignments', 'notes'] as const;
type CampaignTabValue = (typeof CAMPAIGN_TAB_VALUES)[number];

const SELF_SERVE_DEMO_NEXT_STEPS = [
  {
    id: 'assign',
    eyebrow: 'Next step 1 of 6',
    title: 'Split the campaign across 4 reps',
    description: 'Assign Maya, Leo, Ava, and Noah so each person gets a clear zone.',
    tab: 'assignments',
    button: 'Go to split',
  },
  {
    id: 'live-map',
    eyebrow: 'Next step 2 of 6',
    title: 'Watch the live team map',
    description: 'See the 4 demo reps hitting doors across the campaign in real time.',
    tab: 'assignments',
    button: 'Watch live map',
  },
  {
    id: 'reporting',
    eyebrow: 'Next step 3 of 6',
    title: 'Review weekly performance',
    description: 'Open the weekly report with mock visits, callbacks, leads, and rep performance.',
    tab: 'activity',
    button: 'Show weekly report',
  },
  {
    id: 'pricing',
    eyebrow: 'Next step 4 of 6',
    title: 'Pricing is ready',
    description: 'Review the stats, then pricing is ready when they understand the campaign workflow.',
    tab: 'activity',
    button: 'Go to pricing',
  },
  {
    id: 'settings',
    eyebrow: 'Next step 5 of 6',
    title: 'Manage the team',
    description: 'Show invites, member removal, admin roles, and team goals before they unlock the dashboard.',
    tab: 'activity',
    button: 'Open team settings',
  },
  {
    id: 'feedback',
    eyebrow: 'Next step 6 of 6',
    title: 'Review the demo and ask questions',
    description: 'Use the Feedback ? button in the top-right header to tell us what you thought of the demo or ask anything before unlocking the full dashboard.',
    tab: 'activity',
    button: 'Open feedback step',
  },
] as const satisfies ReadonlyArray<{
  id: 'assign' | 'live-map' | 'reporting' | 'pricing' | 'settings' | 'feedback';
  eyebrow: string;
  title: string;
  description: string;
  tab: CampaignTabValue;
  button: string;
}>;

// Keep this prefix compatible with the farm notes timeline because farm notes are stored on campaigns.
const CAMPAIGN_NOTE_TIMELINE_PREFIX = '__FLYR_FARM_NOTE_TIMELINE_V1__';

type CampaignNoteAttachment = {
  name: string;
  url: string;
  type: 'pdf';
};

type CampaignNoteEntry = {
  id: string;
  body: string;
  createdAt: string;
  attachment?: CampaignNoteAttachment;
};

type CampaignNoteTimeline = {
  entries: CampaignNoteEntry[];
};

type CampaignAssignmentMode = 'zone_split' | 'whole_team';

type CampaignAssignmentHomeLite = {
  campaign_address_id: string;
  sequence: number;
};

type CampaignAssignmentLite = {
  id: string;
  campaign_id: string;
  assigned_to_user_id: string;
  mode: CampaignAssignmentMode;
  goal_homes: number;
  zone_index: number | null;
  status: string;
  homes?: CampaignAssignmentHomeLite[];
};

type AssignmentScopeState = {
  role: string | null;
  assignments: CampaignAssignmentLite[];
  addressIds: string[] | null;
  label: string | null;
  description: string | null;
  scopedToAssignedZone: boolean;
};

function isCampaignNotePlaceholder(value: string): boolean {
  return /^\[farm:[0-9a-f-]+\]$/i.test(value.trim());
}

function isCampaignNoteAttachment(value: unknown): value is CampaignNoteAttachment {
  const candidate = value as CampaignNoteAttachment | null;
  return (
    Boolean(candidate) &&
    candidate?.type === 'pdf' &&
    typeof candidate.name === 'string' &&
    typeof candidate.url === 'string'
  );
}

function parseCampaignNoteTimeline(value: string | null | undefined, legacyCreatedAt?: string | null): CampaignNoteTimeline {
  const raw = value?.trim();
  if (!raw || isCampaignNotePlaceholder(raw)) return { entries: [] };

  if (!raw.startsWith(CAMPAIGN_NOTE_TIMELINE_PREFIX)) {
    return {
      entries: [
        {
          id: 'legacy-note',
          body: raw,
          createdAt: legacyCreatedAt ?? new Date(0).toISOString(),
        },
      ],
    };
  }

  try {
    const parsed = JSON.parse(raw.slice(CAMPAIGN_NOTE_TIMELINE_PREFIX.length)) as { entries?: unknown };
    const entries = Array.isArray(parsed.entries)
      ? parsed.entries
          .map((entry): CampaignNoteEntry | null => {
            const candidate = entry as Partial<CampaignNoteEntry> | null;
            if (
              !candidate ||
              typeof candidate.id !== 'string' ||
              typeof candidate.createdAt !== 'string' ||
              typeof candidate.body !== 'string'
            ) {
              return null;
            }

            return {
              id: candidate.id,
              body: candidate.body,
              createdAt: candidate.createdAt,
              attachment: isCampaignNoteAttachment(candidate.attachment) ? candidate.attachment : undefined,
            };
          })
          .filter((entry): entry is CampaignNoteEntry => entry !== null)
      : [];

    return { entries };
  } catch {
    return { entries: [] };
  }
}

function buildCampaignNoteTimeline(entries: CampaignNoteEntry[]): string {
  if (entries.length === 0) return '';
  return `${CAMPAIGN_NOTE_TIMELINE_PREFIX}${JSON.stringify({ entries })}`;
}

function formatCampaignNoteTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Timestamp unavailable';
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatSupabaseError(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;

  const candidate = error as {
    message?: string;
    details?: string | null;
    hint?: string | null;
    code?: string;
  } | null;

  const parts = [
    candidate?.message,
    candidate?.details,
    candidate?.hint ? `Hint: ${candidate.hint}` : undefined,
    candidate?.code ? `Code: ${candidate.code}` : undefined,
  ].filter((part): part is string => Boolean(part && part.trim()));

  return parts.length > 0 ? parts.join('\n') : fallback;
}

function isMissingCampaignColumnError(error: unknown, column: 'notes' | 'scripts' | 'flyer_url'): boolean {
  const message = formatSupabaseError(error, '').toLowerCase();
  return isMissingCampaignColumnErrorMessage(message, column);
}

function buildAssignmentScope(payload: unknown): AssignmentScopeState | null {
  const data = payload as { assignments?: unknown; role?: unknown } | null;
  const role = typeof data?.role === 'string' ? data.role : null;
  const canManage = role === 'owner' || role === 'admin';
  const assignments = Array.isArray(data?.assignments)
    ? data.assignments.filter((assignment): assignment is CampaignAssignmentLite => {
        const candidate = assignment as Partial<CampaignAssignmentLite> | null;
        return (
          Boolean(candidate) &&
          typeof candidate?.id === 'string' &&
          typeof candidate.campaign_id === 'string' &&
          typeof candidate.assigned_to_user_id === 'string' &&
          (candidate.mode === 'zone_split' || candidate.mode === 'whole_team')
        );
      })
    : [];

  if (assignments.length === 0) {
    return {
      role,
      assignments: [],
      addressIds: null,
      label: null,
      description: null,
      scopedToAssignedZone: false,
    };
  }

  const zoneAssignments = assignments.filter((assignment) => assignment.mode === 'zone_split');
  const hasWholeTeamAssignments = assignments.some((assignment) => assignment.mode === 'whole_team');
  const totalHomes =
    hasWholeTeamAssignments && zoneAssignments.length === 0
      ? Math.max(...assignments.map((assignment) => Number(assignment.goal_homes ?? 0)), 0)
      : assignments.reduce((sum, assignment) => sum + Number(assignment.goal_homes ?? 0), 0);

  if (canManage) {
    return {
      role,
      assignments,
      addressIds: null,
      label: 'Assigned',
      description: `${assignments.length} active assignee${assignments.length === 1 ? '' : 's'} · ${totalHomes} homes`,
      scopedToAssignedZone: false,
    };
  }

  if (zoneAssignments.length > 0) {
    const assignedAddressIds = Array.from(
      new Set(
        zoneAssignments.flatMap((assignment) =>
          (Array.isArray(assignment.homes) ? assignment.homes : [])
            .map((home) => home.campaign_address_id)
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        )
      )
    );
    const firstZone = zoneAssignments[0];
    const zoneLabel = firstZone.zone_index ? `Zone ${firstZone.zone_index}` : 'Assigned zone';

    return {
      role,
      assignments,
      addressIds: assignedAddressIds,
      label: zoneLabel,
      description: `${assignedAddressIds.length || totalHomes} homes assigned to you · only your area is shown`,
      scopedToAssignedZone: true,
    };
  }

  return {
    role,
    assignments,
    addressIds: null,
    label: 'Assigned',
    description: `${totalHomes} home goal · shared campaign view`,
    scopedToAssignedZone: false,
  };
}

function getLinkQualityBanner(campaign: CampaignV2 | null): {
  badgeVariant: 'default' | 'secondary' | 'outline' | 'destructive';
  badgeLabel: string;
  message: string;
} | null {
  const status = campaign?.link_quality_status ?? 'unknown';
  const score = campaign?.link_quality_score;
  const reason = campaign?.link_quality_reason;

  if (status === 'unknown') return null;

  if (status === 'healthy') {
    return {
      badgeVariant: 'outline',
      badgeLabel: `Data Quality${typeof score === 'number' ? ` ${score}` : ''}`,
      message: 'Address and building coverage are within target thresholds.',
    };
  }

  if (status === 'repairing') {
    return {
      badgeVariant: 'secondary',
      badgeLabel: 'Data Repair Queued',
      message: reason || 'A background repair pass is queued to improve campaign data quality.',
    };
  }

  return {
    badgeVariant: status === 'failed' ? 'destructive' : 'secondary',
    badgeLabel: 'Data Quality Review',
    message: reason || 'This campaign has degraded data quality and may need review.',
  };
}

function CampaignLeadsTab({
  contacts,
  campaignId,
  userId,
  workspaceId,
  onRefresh,
}: {
  contacts: Contact[];
  campaignId: string;
  userId: string | null;
  workspaceId: string | null | undefined;
  onRefresh: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const filtered = contacts.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      (c.full_name || '').toLowerCase().includes(q) ||
      (c.phone || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.address || '').toLowerCase().includes(q)
    );
  });

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this contact?')) return;
    try {
      await ContactsService.deleteContact(id);
      onRefresh();
    } catch (e) {
      console.error('Delete contact:', e);
      alert(e instanceof Error ? e.message : 'Failed to delete contact');
    }
  };

  const formatDate = (s: string | null | undefined) => {
    if (!s) return '—';
    const d = new Date(s);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
  };

  return (
    <div className="space-y-4">
      <div className="bg-card p-4 rounded-xl border border-border">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">Campaign Leads</h2>
            <Badge variant="secondary" className="text-xs">{contacts.length}</Badge>
          </div>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="w-4 h-4 mr-1" />
            Add contact
          </Button>
        </div>

        <div className="relative mb-4">
          <input
            type="text"
            placeholder="Search by name, phone, email, or address..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-3 pr-3 py-2 rounded-lg border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">
              {searchQuery ? 'No contacts match your search.' : 'No contacts yet. Add a contact to get started.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Name</th>
                  <th className="pb-2 pr-3 font-medium">Phone</th>
                  <th className="pb-2 pr-3 font-medium">Email</th>
                  <th className="pb-2 pr-3 font-medium">Address</th>
                  <th className="pb-2 pr-3 font-medium">Last contacted</th>
                  <th className="pb-2 pr-3 font-medium">Status</th>
                  <th className="pb-2 w-16 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="border-b border-border/50">
                    <td className="py-2 pr-3 text-foreground">{c.full_name || '—'}</td>
                    <td className="py-2 pr-3 text-foreground">{c.phone || '—'}</td>
                    <td className="py-2 pr-3 text-foreground">{c.email || '—'}</td>
                    <td className="py-2 pr-3 text-foreground max-w-[180px] truncate" title={c.address || undefined}>{c.address || '—'}</td>
                    <td className="py-2 pr-3 text-foreground">{formatDate(c.last_contacted)}</td>
                    <td className="py-2 pr-3 text-foreground">{c.status || '—'}</td>
                    <td className="py-2">
                      <button
                        type="button"
                        onClick={() => handleDelete(c.id)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-muted text-xs"
                        aria-label="Delete"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {userId && (
        <CreateContactDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onSuccess={() => { setAddOpen(false); onRefresh(); }}
          userId={userId}
          workspaceId={workspaceId ?? undefined}
          initialCampaignId={campaignId}
        />
      )}
    </div>
  );
}

export default function CampaignDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const campaignId = params.campaignId as string;
  const { currentWorkspaceId, membershipsByWorkspaceId } = useWorkspace();
  const { setTheme } = useTheme();
  const currentWorkspaceRole = currentWorkspaceId ? membershipsByWorkspaceId[currentWorkspaceId] ?? null : null;
  const isSelfServeDemo = searchParams.get('source') === 'self-serve-demo';
  const requestedTab = searchParams.get('tab');
  const initialTab: CampaignTabValue =
    requestedTab && CAMPAIGN_TAB_VALUES.includes(requestedTab as CampaignTabValue)
      ? (requestedTab as CampaignTabValue)
      : 'map';

  const [campaign, setCampaign] = useState<CampaignV2 | null>(null);
  const [addresses, setAddresses] = useState<CampaignAddress[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [addressesLoading, setAddressesLoading] = useState(false);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [scanEventsLoading, setScanEventsLoading] = useState(false);
  const [roadMetadataLoading, setRoadMetadataLoading] = useState(false);
  const [addressesError, setAddressesError] = useState(false);
  const [contactsError, setContactsError] = useState(false);
  const [scanEventsError, setScanEventsError] = useState(false);
  const [roadMetadataError, setRoadMetadataError] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [showMissingQRModal, setShowMissingQRModal] = useState(false);
  const [missingQRFlyerId, setMissingQRFlyerId] = useState<string | null>(null);
  const [destinationUrl, setDestinationUrl] = useState('');
  const [isSavingUrl, setIsSavingUrl] = useState(false);
  const [notes, setNotes] = useState('');
  const [campaignNoteDraft, setCampaignNoteDraft] = useState('');
  const [campaignNotePdf, setCampaignNotePdf] = useState<File | null>(null);
  const [campaignNotePdfInputKey, setCampaignNotePdfInputKey] = useState(0);
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [basicQrBase64, setBasicQrBase64] = useState<string | null>(null);
  const [generatingBasicQr, setGeneratingBasicQr] = useState(false);
  const [qrScanEventsCount, setQrScanEventsCount] = useState<number | null>(null);
  const [roadMetadata, setRoadMetadata] = useState<CampaignRoadMetadata | null>(null);
  const [assignmentScope, setAssignmentScope] = useState<AssignmentScopeState | null>(null);
  const [activeTab, setActiveTab] = useState<CampaignTabValue>(initialTab);
  const [demoGuideOpen, setDemoGuideOpen] = useState(
    isSelfServeDemo && searchParams.get('tour') !== '0'
  );
  const [demoNextStepIndex, setDemoNextStepIndex] = useState(0);
  const selfServeProvisionStartedRef = useRef(false);
  const campaignStats: CampaignStats = useMemo(
    () => deriveCampaignStats(addresses, contacts),
    [addresses, contacts]
  );
  const legacyCampaignText = parseLegacyCampaignText(
    (campaign as CampaignWithLegacyDescription | null)?.description
  );
  const currentFlyerUrl = campaign?.flyer_url ?? legacyCampaignText.flyerUrl ?? null;
  const currentScripts = campaign?.scripts ?? legacyCampaignText.scripts ?? undefined;
  const campaignNoteEntries = useMemo(
    () => parseCampaignNoteTimeline(notes, campaign?.created_at).entries,
    [campaign?.created_at, notes]
  );
  const sortedCampaignNoteEntries = useMemo(
    () =>
      [...campaignNoteEntries].sort(
        (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      ),
    [campaignNoteEntries]
  );
  const canAddCampaignNote = Boolean(campaignNoteDraft.trim() || campaignNotePdf);

  const loadSecondaryData = useCallback(async () => {
    const supabase = createClient();

    setAddressesLoading(true);
    setContactsLoading(true);
    setScanEventsLoading(true);
    setRoadMetadataLoading(true);
    setAddressesError(false);
    setContactsError(false);
    setScanEventsError(false);
    setRoadMetadataError(false);

    const fallbackMemberScope: AssignmentScopeState | null =
      currentWorkspaceRole === 'member'
        ? {
            role: currentWorkspaceRole,
            assignments: [],
            addressIds: [],
            label: 'Assigned',
            description: 'Could not verify your assigned zone yet.',
            scopedToAssignedZone: true,
          }
        : null;

    const assignmentScopeRequest = fetch(`/api/campaigns/${campaignId}/assignments`, {
      credentials: 'include',
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          console.warn('Unable to fetch campaign assignment scope:', payload?.error ?? response.statusText);
          setAssignmentScope(fallbackMemberScope);
          return fallbackMemberScope;
        }
        const nextScope = buildAssignmentScope(payload);
        setAssignmentScope(nextScope);
        return nextScope;
      })
      .catch((error) => {
        console.warn('Unable to fetch campaign assignment scope:', error);
        setAssignmentScope(fallbackMemberScope);
        return fallbackMemberScope;
      });

    const addressesRequest = assignmentScopeRequest
      .then((scope) => {
        const addressIds = scope?.scopedToAssignedZone ? scope.addressIds ?? [] : null;
        return CampaignsService.fetchAddresses(campaignId, { addressIds });
      })
      .then((addressesData) => {
        setAddresses(addressesData);
      })
      .catch((error) => {
        console.error('Error loading campaign addresses:', error);
        setAddressesError(true);
        setAddresses([]);
      })
      .finally(() => {
        setAddressesLoading(false);
      });

    const contactsRequest = ContactsService.fetchContacts(userId ?? '', currentWorkspaceId, { campaignId })
      .then((contactsData) => {
        setContacts(contactsData);
      })
      .catch((error) => {
        console.error('Error loading campaign contacts:', error);
        setContactsError(true);
        setContacts([]);
      })
      .finally(() => {
        setContactsLoading(false);
      });

    const scanEventsRequest = (async () => {
      try {
        const scanEventsRes = await supabase
          .from('scan_events')
          .select('id', { count: 'exact', head: true })
          .eq('campaign_id', campaignId);
        if (scanEventsRes.error) {
          console.warn('Unable to fetch scan_events count:', scanEventsRes.error.message);
          setScanEventsError(true);
          setQrScanEventsCount(null);
          return;
        }
        setQrScanEventsCount(scanEventsRes.count ?? 0);
      } catch (error) {
        console.error('Error loading scan_events count:', error);
        setScanEventsError(true);
        setQrScanEventsCount(null);
      } finally {
        setScanEventsLoading(false);
      }
    })();

    const roadMetadataRequest = (async () => {
      try {
        const roadMetaRes = await supabase.rpc('rpc_get_campaign_road_metadata', { p_campaign_id: campaignId });
        if (!roadMetaRes.error && roadMetaRes.data) {
          setRoadMetadata(roadMetaRes.data as CampaignRoadMetadata);
          return;
        }
        if (roadMetaRes.error) {
          console.warn('Unable to fetch road metadata:', roadMetaRes.error.message);
          setRoadMetadataError(true);
        }
        setRoadMetadata(null);
      } catch (error) {
        console.error('Error loading road metadata:', error);
        setRoadMetadataError(true);
        setRoadMetadata(null);
      } finally {
        setRoadMetadataLoading(false);
      }
    })();

    await Promise.allSettled([
      addressesRequest,
      contactsRequest,
      scanEventsRequest,
      roadMetadataRequest,
    ]);
  }, [campaignId, currentWorkspaceRole]);

  const loadData = useCallback(async () => {
    setLoadError(false);
    try {
      const campaignData = await CampaignsService.fetchCampaign(campaignId);
      if (!campaignData) {
        setLoading(false);
        return;
      }

      setCampaign(campaignData);
      setLoading(false);
      void loadSecondaryData();
    } catch (error) {
      console.error('Error loading campaign:', error);
      if ((error as { code?: string } | null)?.code === 'PGRST116') {
        setCampaign(null);
      } else {
        setLoadError(true);
      }
      setLoading(false);
    }
  }, [campaignId, loadSecondaryData]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!isSelfServeDemo || !campaign?.id || !campaign.territory_boundary) return;
    if (selfServeProvisionStartedRef.current || campaign.provision_status === 'ready') return;

    let alreadyStartedFromCreate = false;
    try {
      alreadyStartedFromCreate =
        window.sessionStorage.getItem(`flyr-self-serve-provision-started:${campaign.id}`) === '1';
    } catch {
      alreadyStartedFromCreate = false;
    }
    if (alreadyStartedFromCreate && campaign.provision_status === 'pending') {
      selfServeProvisionStartedRef.current = true;
      return;
    }

    const shouldStartProvision =
      searchParams.get('building') === '1' ||
      (!addressesLoading && addresses.length === 0 && campaign.provision_status !== 'pending');
    if (!shouldStartProvision) return;

    selfServeProvisionStartedRef.current = true;
    void fetch('/api/campaigns/provision', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id: campaign.id }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          console.warn(
            '[CampaignDetailPage] Self-serve provision kickoff failed:',
            payload?.error ?? response.statusText
          );
        }
        await loadData();
      })
      .catch((error) => {
        selfServeProvisionStartedRef.current = false;
        console.warn('[CampaignDetailPage] Self-serve provision kickoff failed:', error);
      });
  }, [
    addresses.length,
    addressesLoading,
    campaign?.id,
    campaign?.provision_status,
    campaign?.territory_boundary,
    isSelfServeDemo,
    loadData,
    searchParams,
  ]);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id);
    });
  }, []);

  // Poll road metadata when status is fetching
  useEffect(() => {
    if (roadMetadata?.roads_status !== 'fetching' || !campaignId) return;
    const supabase = createClient();
    const interval = setInterval(async () => {
      const { data } = await supabase.rpc('rpc_get_campaign_road_metadata', { p_campaign_id: campaignId });
      if (data) setRoadMetadata(data as CampaignRoadMetadata);
    }, 3000);
    return () => clearInterval(interval);
  }, [campaignId, roadMetadata?.roads_status]);

  useEffect(() => {
    const parcelStatus = campaign?.parcel_enrichment_status;
    const provisionStatus = campaign?.provision_status;
    const provisionPhase = campaign?.provision_phase;
    const shouldPollParcelStatus = parcelStatus === 'queued' || parcelStatus === 'processing';
    const shouldPollSelfServeBuild =
      isSelfServeDemo && searchParams.get('building') === '1' && provisionStatus !== 'ready';
    const shouldPollProvisionStage =
      provisionStatus === 'pending' ||
      provisionPhase === 'map_ready' ||
      provisionPhase === 'optimizing' ||
      shouldPollSelfServeBuild;

    if (!campaignId || (!shouldPollParcelStatus && !shouldPollProvisionStage)) return;

    const interval = setInterval(() => {
      void loadData();
    }, 5000);

    return () => clearInterval(interval);
  }, [
    campaignId,
    campaign?.parcel_enrichment_status,
    campaign?.provision_status,
    campaign?.provision_phase,
    isSelfServeDemo,
    loadData,
    searchParams,
  ]);

  useEffect(() => {
    if (campaign?.video_url) setDestinationUrl(campaign.video_url);
  }, [campaign]);

  useEffect(() => {
    if (campaign?.notes !== undefined) {
      setNotes(campaign.notes ?? '');
      return;
    }
    setNotes(legacyCampaignText.notes ?? '');
  }, [campaign?.notes, legacyCampaignText.notes]);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (isSelfServeDemo) setTheme('light');
  }, [isSelfServeDemo, setTheme]);

  useEffect(() => {
    if (isSelfServeDemo && searchParams.get('tour') === '1') {
      setDemoGuideOpen(true);
    }
  }, [isSelfServeDemo, searchParams]);

  const focusCampaignTabs = useCallback(() => {
    window.setTimeout(() => {
      document.getElementById('campaign-demo-tabs')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 50);
  }, []);

  const handleDemoNextStep = useCallback(() => {
    const step = SELF_SERVE_DEMO_NEXT_STEPS[demoNextStepIndex] ?? SELF_SERVE_DEMO_NEXT_STEPS[0];
    if (step.id === 'pricing') {
      window.location.href = `/pricing?source=self-serve-demo&campaign=${encodeURIComponent(campaignId)}`;
      return;
    }
    if (step.id === 'live-map') {
      window.location.href = `/home?tab=map&source=self-serve-demo&demoLive=1&campaign=${encodeURIComponent(campaignId)}`;
      return;
    }
    if (step.id === 'reporting') {
      window.location.href = `/home?tab=reporting&source=self-serve-demo&demoReport=1&campaign=${encodeURIComponent(campaignId)}`;
      return;
    }
    if (step.id === 'settings') {
      window.location.href = `/home?tab=settings&source=self-serve-demo&demoReport=1&invite=members&campaign=${encodeURIComponent(campaignId)}`;
      return;
    }
    if (step.id === 'feedback') {
      window.location.href = `/home?tab=settings&source=self-serve-demo&demoReport=1&demoFeedback=1&campaign=${encodeURIComponent(campaignId)}`;
      return;
    }

    setActiveTab(step.tab);
    setDemoNextStepIndex((current) => Math.min(current + 1, SELF_SERVE_DEMO_NEXT_STEPS.length - 1));
    setDemoGuideOpen(true);
    focusCampaignTabs();
  }, [campaignId, demoNextStepIndex, focusCampaignTabs]);

  const handleDemoSplitComplete = useCallback(() => {
    window.location.href = `/home?tab=map&source=self-serve-demo&demoLive=1&campaign=${encodeURIComponent(campaignId)}`;
  }, [campaignId]);

  const saveLegacyCampaignText = useCallback(
    async (updates: { notes?: string; scripts?: string; flyerUrl?: string }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from('campaigns')
        .update({
          description: buildLegacyCampaignText({
            notes: updates.notes ?? notes,
            scripts: updates.scripts ?? currentScripts,
            flyerUrl: updates.flyerUrl ?? currentFlyerUrl ?? undefined,
          }),
        })
        .eq('id', campaignId);
      if (error) throw error;
    },
    [campaignId, currentFlyerUrl, currentScripts, notes]
  );

  const handleGenerateQRs = async (trackable: boolean = true) => {
    setGenerating(true);
    try {
      const response = await fetch('/api/generate-qrs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          trackable,
          baseUrl: typeof window !== 'undefined' ? window.location.origin : undefined,
          forceRegenerate: true,
        }),
      });
      const data = await response.json();
      if (data.needsUpgrade) {
        setShowPaywall(true);
        return;
      }
      if (!response.ok) {
        if (data.error === 'MISSING_QR') {
          setMissingQRFlyerId(data.flyerId || null);
          setShowMissingQRModal(true);
          return;
        }
        throw new Error(data.error || data.message || 'Generation failed');
      }

      // Consolidated behavior: also export/download the full advanced QR package.
      if (addresses?.length) {
        const rows = addresses.map((addr) => {
          const parts = (addr.formatted || addr.address || '').split(', ');
          return {
            AddressLine: addr.address || parts[0] || '',
            City: addr.locality || parts[1] || '',
            Province: addr.region || parts[2] || '',
            PostalCode: addr.postal_code || '',
          };
        });

        const canvaResponse = await fetch('/api/canva/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaignId,
            baseUrl: `${typeof window !== 'undefined' ? window.location.origin : 'https://flyrpro.app'}/api/scan`,
            rows,
          }),
        });

        if (!canvaResponse.ok) {
          const errorData = await canvaResponse.json().catch(() => ({}));
          throw new Error(errorData.error || `Failed to download advanced QR package (HTTP ${canvaResponse.status})`);
        }

        const contentDisposition = canvaResponse.headers.get('Content-Disposition') || '';
        const filenameMatch = contentDisposition.match(/filename="(.+)"/);
        const filename = filenameMatch ? filenameMatch[1] : `canva_qr_${campaignId}.zip`;

        const blob = await canvaResponse.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }

      await loadData();
      alert(`Generated ${data.count} QR codes and downloaded the full advanced QR package.`);
    } catch (error) {
      console.error('Error generating QRs:', error);
      alert(error instanceof Error ? error.message : 'Failed to generate QR codes');
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveUrl = async () => {
    setIsSavingUrl(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('campaigns')
        .update({ video_url: destinationUrl || null })
        .eq('id', campaignId);
      if (error) alert('Error saving URL: ' + error.message);
      else {
        alert('Destination URL Saved! All QR codes now point here.');
        await loadData();
      }
    } catch {
      alert('Error saving URL');
    } finally {
      setIsSavingUrl(false);
    }
  };

  const handleAddCampaignNote = async () => {
    if (!campaignId) return;

    const noteBody = campaignNoteDraft.trim();
    const attachmentFile = campaignNotePdf;
    if (!noteBody && !attachmentFile) return;

    setIsSavingNotes(true);
    try {
      const supabase = createClient();
      let attachment: CampaignNoteAttachment | undefined;

      if (attachmentFile) {
        if (attachmentFile.type !== 'application/pdf') {
          throw new Error('Invalid file type. Use a PDF.');
        }
        if (attachmentFile.size > FLYER_MAX_SIZE_MB * 1024 * 1024) {
          throw new Error(`File too large. Maximum size is ${FLYER_MAX_SIZE_MB}MB.`);
        }

        const path = `campaign-note-attachments/${campaignId}/${crypto.randomUUID()}.pdf`;
        const { error: uploadError } = await supabase.storage.from('flyers').upload(path, attachmentFile, {
          contentType: attachmentFile.type,
          upsert: false,
        });
        if (uploadError) throw uploadError;

        const { data: urlData } = supabase.storage.from('flyers').getPublicUrl(path);
        attachment = {
          name: attachmentFile.name,
          url: urlData.publicUrl,
          type: 'pdf',
        };
      }

      const nextEntry: CampaignNoteEntry = {
        id: crypto.randomUUID(),
        body: noteBody,
        createdAt: new Date().toISOString(),
        attachment,
      };
      const nextNotes = buildCampaignNoteTimeline([...campaignNoteEntries, nextEntry]);
      const { error } = await supabase
        .from('campaigns')
        .update({ notes: nextNotes || null })
        .eq('id', campaignId);
      if (error) {
        if (isMissingCampaignColumnError(error, 'notes')) {
          await saveLegacyCampaignText({ notes: nextNotes });
        } else {
          throw error;
        }
      }
      setNotes(nextNotes);
      setCampaignNoteDraft('');
      setCampaignNotePdf(null);
      setCampaignNotePdfInputKey((value) => value + 1);
      await loadData();
    } catch (e) {
      console.error('Error saving notes:', e);
      alert(formatSupabaseError(e, 'Failed to save notes'));
    } finally {
      setIsSavingNotes(false);
    }
  };

  const handleGenerateBasicQr = async () => {
    setGeneratingBasicQr(true);
    try {
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : undefined;
      const res = await fetch(`/api/campaigns/${campaignId}/generate-basic-qr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const { qrBase64 } = await res.json();
      if (qrBase64) {
        setBasicQrBase64(qrBase64);
        const link = document.createElement('a');
        link.href = qrBase64;
        link.download = `campaign-${campaignId}-basic-qr.png`;
        link.click();
      } else {
        setBasicQrBase64(null);
      }
    } catch (e) {
      console.error('Generate basic QR:', e);
      alert(e instanceof Error ? e.message : 'Failed to generate basic QR');
    } finally {
      setGeneratingBasicQr(false);
    }
  };

  const handleDownloadBasicQr = () => {
    if (!basicQrBase64) return;
    const link = document.createElement('a');
    link.href = basicQrBase64;
    link.download = `campaign-${campaignId}-basic-qr.png`;
    link.click();
  };

  const handleAddQR = async () => {
    if (!missingQRFlyerId) {
      setShowMissingQRModal(false);
      return;
    }
    try {
      const response = await fetch(`/api/flyers/${missingQRFlyerId}/add-qr`, { method: 'POST' });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to add QR');
      }
      setShowMissingQRModal(false);
      setMissingQRFlyerId(null);
      await handleGenerateQRs(true);
    } catch (error) {
      console.error('Error adding QR:', error);
      alert(error instanceof Error ? error.message : 'Failed to add QR element');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[320px]">
        <LoadingScreen variant="inline" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[320px] px-6 text-center">
        <h2 className="text-lg font-semibold text-foreground mb-2">Failed to load campaign</h2>
        <p className="text-sm text-muted-foreground mb-4">
          There was a problem loading this campaign. Please try again.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button onClick={loadData}>Try again</Button>
          <Button asChild variant="outline">
            <Link href="/campaigns">Back to campaigns</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[320px] px-6 text-center">
        <h2 className="text-lg font-semibold text-foreground mb-2">Campaign not found</h2>
        <Button asChild variant="outline">
          <Link href="/campaigns">Back to Campaign</Link>
        </Button>
      </div>
    );
  }

  const normalizeAddressText = (value: string | null | undefined) =>
    value?.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() ?? '';

  const getAddressSearchCandidates = (addr: CampaignAddress) => {
    const joinedStreet = [addr.house_number, addr.street_name].filter(Boolean).join(' ').trim();
    const fullAddress = [
      joinedStreet || addr.address || addr.formatted || '',
      addr.locality || '',
      addr.region || '',
      addr.postal_code || '',
    ]
      .filter(Boolean)
      .join(' ')
      .trim();

    return Array.from(
      new Set(
        [addr.formatted, addr.address, joinedStreet, fullAddress]
          .map((value) => normalizeAddressText(value))
          .filter(Boolean)
      )
    );
  };

  // Dedupe by logical address: one row per (formatted + postal_code), prefer scanned
  const addressKey = (addr: CampaignAddress) =>
    `${(addr.formatted || addr.address || '').trim().toLowerCase()}|${(addr.postal_code || '').trim().toLowerCase()}`;
  const seen = new Map<string, CampaignAddress>();
  for (const addr of addresses) {
    const key = addressKey(addr);
    const existing = seen.get(key);
    const addrVisited = isVisitedCampaignAddress(addr);
    if (!existing) {
      seen.set(key, addr);
    } else if (addrVisited && !isVisitedCampaignAddress(existing)) {
      seen.set(key, addr);
    } else if (
      getCampaignAddressMapStatus(addr) !== 'none' &&
      getCampaignAddressMapStatus(existing) === 'none'
    ) {
      seen.set(key, addr);
    } else if (addrVisited === isVisitedCampaignAddress(existing) && (addr.id < existing.id)) {
      seen.set(key, addr);
    }
  }
  const dedupedAddresses = Array.from(seen.values());
  const addressIdToLogicalKey = new Map(addresses.map((addr) => [addr.id, addressKey(addr)]));
  const logicalKeysBySearchText = new Map<string, Set<string>>();

  for (const addr of addresses) {
    const logicalKey = addressKey(addr);
    for (const candidate of getAddressSearchCandidates(addr)) {
      const keys = logicalKeysBySearchText.get(candidate) ?? new Set<string>();
      keys.add(logicalKey);
      logicalKeysBySearchText.set(candidate, keys);
    }
  }

  const contactsByLogicalAddress = new Map<string, Set<string>>();

  for (const contact of contacts) {
    const contactLabel = contact.name?.trim() || contact.email?.trim() || contact.phone?.trim();
    if (!contactLabel) continue;

    const matchedLogicalKeys = new Set<string>();

    if (contact.address_id) {
      const logicalKey = addressIdToLogicalKey.get(contact.address_id);
      if (logicalKey) matchedLogicalKeys.add(logicalKey);
    }

    const normalizedContactAddress = normalizeAddressText(contact.address);
    if (normalizedContactAddress) {
      const logicalKeys = logicalKeysBySearchText.get(normalizedContactAddress);
      logicalKeys?.forEach((logicalKey) => matchedLogicalKeys.add(logicalKey));
    }

    matchedLogicalKeys.forEach((logicalKey) => {
      const labels = contactsByLogicalAddress.get(logicalKey) ?? new Set<string>();
      labels.add(contactLabel);
      contactsByLogicalAddress.set(logicalKey, labels);
    });
  }

  const totalHomesInCampaign = campaignStats.addresses || dedupedAddresses.length;
  const homesWithQrScans = campaignStats.scanned || dedupedAddresses.filter((addr) => (addr.scans || 0) > 0).length;
  const fallbackTotalQrScans = Math.max(
    dedupedAddresses.reduce((total, addr) => total + (addr.scans || 0), 0),
    campaign.scans || 0
  );
  const totalQrScans = Math.max(qrScanEventsCount ?? 0, fallbackTotalQrScans);
  const advancedHomesScanned = dedupedAddresses
    .filter((addr) => (addr.scans || 0) > 0)
    .sort((a, b) => {
      const aTime = a.last_scanned_at ? new Date(a.last_scanned_at).getTime() : 0;
      const bTime = b.last_scanned_at ? new Date(b.last_scanned_at).getTime() : 0;
      if (bTime !== aTime) return bTime - aTime;
      return (b.scans || 0) - (a.scans || 0);
    })
    .slice(0, 10);

  const formattedRecipients = dedupedAddresses.map((addr) => {
    const { statusKey, label } = getAddressRecipientsStatus(addr);
    const matchedContacts = Array.from(contactsByLogicalAddress.get(addressKey(addr)) ?? []);

    return {
      id: addr.id,
      address_line: addr.formatted || addr.address || '',
      city: addr.locality || '',
      region: addr.region || '',
      postal_code: addr.postal_code || '',
      status: statusKey,
      statusLabel: label,
      canMarkVisited: !isVisitedCampaignAddress(addr),
      qr_png_url: null,
      qr_code_base64: addr.qr_code_base64 || null,
      sent_at: null,
      scanned_at:
        isVisitedCampaignAddress(addr) || (addr.scans ?? 0) > 0 ? addr.last_scanned_at ?? null : null,
      street_name: addr.street_name,
      house_number: addr.house_number,
      locality: addr.locality,
      seq: addr.seq,
      contacts: matchedContacts,
    };
  });
  const hasGeneratedAdvancedQr = formattedRecipients.some((recipient) => Boolean(recipient.qr_code_base64));
  const selfServeHomeCapNotice =
    isSelfServeDemo &&
    typeof campaign?.data_quality_reason === 'string' &&
    campaign.data_quality_reason.includes('free demo loaded')
      ? campaign.data_quality_reason
      : null;
  const demoNextStep = SELF_SERVE_DEMO_NEXT_STEPS[demoNextStepIndex] ?? SELF_SERVE_DEMO_NEXT_STEPS[0];

  return (
    <div className={isSelfServeDemo ? 'relative min-h-full bg-background text-foreground' : 'min-h-full bg-muted/30 dark:bg-background relative'}>
      {/* Progress bar only – campaign name is in layout header */}
      {campaignStats.addresses > 0 && campaignStats.progress_pct > 0 && (
        <div className="bg-card border-b border-border px-4 sm:px-6 lg:px-8 py-2">
          <div className="max-w-7xl mx-auto min-w-0 max-w-md sm:max-w-lg flex items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">Progress</span>
            <Progress
              value={campaignStats.progress_pct}
              className="h-2 flex-1 bg-emerald-500/20 dark:bg-emerald-500/25 [&>[data-slot=progress-indicator]]:bg-emerald-500"
            />
            <span className="text-sm font-semibold text-foreground whitespace-nowrap">{campaignStats.progress_pct}%</span>
          </div>
        </div>
      )}

      <main className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        <StatsHeader stats={campaignStats} />
        {isSelfServeDemo ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 shadow-sm dark:border-border dark:bg-card">
            <div className="flex flex-col">
              {demoGuideOpen ? (
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-border dark:bg-background">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-muted-foreground">
                        {demoNextStep.eyebrow}
                      </p>
                      <h2 className="mt-1 text-base font-semibold text-slate-950 dark:text-foreground">{demoNextStep.title}</h2>
                    </div>
                    <button
                      type="button"
                      className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-950 dark:text-muted-foreground dark:hover:bg-muted dark:hover:text-foreground"
                      aria-label="Close next steps"
                      onClick={() => setDemoGuideOpen(false)}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <p className="text-sm leading-5 text-slate-700 dark:text-muted-foreground">{demoNextStep.description}</p>

                  {demoNextStep.id === 'assign' ? (
                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-border dark:bg-card">
                      <p className="text-xs font-medium text-slate-600 dark:text-muted-foreground">Mock members</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {['Maya', 'Leo', 'Ava', 'Noah'].map((member) => (
                          <span
                            key={member}
                            className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-900 dark:border-border dark:bg-background dark:text-foreground"
                          >
                            {member}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {demoNextStep.id === 'live-map' ? (
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-border dark:bg-card">
                        <p className="text-lg font-bold text-slate-950 dark:text-foreground">{totalHomesInCampaign.toLocaleString()}</p>
                        <p className="text-[11px] text-slate-600 dark:text-muted-foreground">homes</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-border dark:bg-card">
                        <p className="text-lg font-bold text-slate-950 dark:text-foreground">4</p>
                        <p className="text-[11px] text-slate-600 dark:text-muted-foreground">members</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-border dark:bg-card">
                        <p className="text-lg font-bold text-slate-950 dark:text-foreground">Live</p>
                        <p className="text-[11px] text-slate-600 dark:text-muted-foreground">map</p>
                      </div>
                    </div>
                  ) : null}

                  {demoNextStep.id === 'reporting' || demoNextStep.id === 'pricing' ? (
                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-border dark:bg-card">
                      <p className="mb-2 text-xs font-medium text-slate-600 dark:text-muted-foreground">Reporting snapshot</p>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div>
                          <p className="text-lg font-bold text-slate-950 dark:text-foreground">12</p>
                          <p className="text-[11px] text-slate-600 dark:text-muted-foreground">visits</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-slate-950 dark:text-foreground">4</p>
                          <p className="text-[11px] text-slate-600 dark:text-muted-foreground">callbacks</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-slate-950 dark:text-foreground">2</p>
                          <p className="text-[11px] text-slate-600 dark:text-muted-foreground">leads</p>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {demoNextStep.id === 'settings' ? (
                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-border dark:bg-card">
                      <p className="mb-2 text-xs font-medium text-slate-600 dark:text-muted-foreground">Team administration</p>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div>
                          <p className="text-lg font-bold text-slate-950 dark:text-foreground">Invite</p>
                          <p className="text-[11px] text-slate-600 dark:text-muted-foreground">members</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-slate-950 dark:text-foreground">Remove</p>
                          <p className="text-[11px] text-slate-600 dark:text-muted-foreground">access</p>
                        </div>
                        <div>
                          <p className="text-lg font-bold text-slate-950 dark:text-foreground">Admin</p>
                          <p className="text-[11px] text-slate-600 dark:text-muted-foreground">roles</p>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <Button
                    type="button"
                    className="mt-4 w-full"
                    onClick={handleDemoNextStep}
                    data-self-serve-demo-flow="true"
                  >
                    {demoNextStep.id === 'assign' ? <Users className="h-4 w-4" /> : null}
                    {demoNextStep.id === 'live-map' ? <MapPin className="h-4 w-4" /> : null}
                    {demoNextStep.id === 'reporting' ? <BarChart3 className="h-4 w-4" /> : null}
                    {demoNextStep.id === 'settings' ? <Users className="h-4 w-4" /> : null}
                    {demoNextStep.button}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-slate-200 bg-white text-slate-950 hover:bg-slate-50 dark:border-border dark:bg-background dark:text-foreground dark:hover:bg-muted"
                  onClick={() => setDemoGuideOpen(true)}
                  data-self-serve-demo-flow="true"
                >
                  Next steps
                  <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        ) : null}
        {selfServeHomeCapNotice ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
            <div className="flex flex-wrap items-start gap-3">
              <Badge variant="outline" className="border-amber-300 bg-white text-amber-900 dark:border-amber-800 dark:bg-background dark:text-amber-100">
                Free demo
              </Badge>
              <p className="min-w-0 flex-1">{selfServeHomeCapNotice}</p>
            </div>
          </div>
        ) : null}
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as CampaignTabValue)}
          className="w-full"
          id="campaign-demo-tabs"
        >
          <TabsList>
            <TabsTrigger value="map">Map</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="addresses">Addresses</TabsTrigger>
            <TabsTrigger value="contacts">Contacts</TabsTrigger>
            <TabsTrigger value="qr">QR Codes</TabsTrigger>
            <TabsTrigger value="finance">Finance</TabsTrigger>
            <TabsTrigger value="assignments">Assignments</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
          </TabsList>

          <TabsContent value="map" className="mt-4 space-y-4" data-self-serve-demo-allow="true">
            {roadMetadataLoading ? (
              <p className="text-xs text-muted-foreground">Loading road metadata…</p>
            ) : roadMetadataError ? (
              <InlineSectionError
                message="Could not load road metadata."
                onRetry={() => void loadSecondaryData()}
              />
            ) : null}
            <div className="bg-card rounded-xl border border-border overflow-hidden" style={{ height: '560px' }}>
              <CampaignDetailMapView
                campaignId={campaignId}
                addresses={addresses}
                campaign={campaign}
                visibleAddressIds={assignmentScope?.scopedToAssignedZone ? assignmentScope.addressIds ?? [] : undefined}
                onSnapComplete={loadData}
                onContactCreated={loadSecondaryData}
                buildingPendingOverlay={{
                  title: 'Buildings loading',
                  description: 'Buildings will appear soon. This may take a minute.',
                }}
              />
            </div>
          </TabsContent>

          <TabsContent value="activity" className="mt-4">
            <div className="bg-card p-4 rounded-xl border border-border space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground mb-1">Campaign activity</h2>
                <p className="text-sm text-muted-foreground">
                  Canvassing sessions for this campaign.
                </p>
                <Link
                  href="/activity"
                  className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline mt-2"
                >
                  View all workspace activity
                </Link>
              </div>
              <ActivityPageView
                campaignId={campaignId}
                forcedTypeFilter="session_completed"
                hideFilterControls
                defaultRangePreset="all"
                emptyMessage="No sessions for this campaign yet."
              />
            </div>
          </TabsContent>

          <TabsContent value="addresses" className="mt-4">
            <div className="bg-card p-4 rounded-xl border border-border">
              <h2 className="text-sm font-semibold text-foreground mb-3">Addresses</h2>
              {addressesLoading ? (
                <SectionLoadingSkeleton label="Loading addresses" />
              ) : addressesError ? (
                <InlineSectionError
                  message="Could not load addresses."
                  onRetry={() => void loadSecondaryData()}
                />
              ) : (
                <RecipientsTable recipients={formattedRecipients} campaignId={campaignId} onRefresh={loadData} />
              )}
            </div>
          </TabsContent>

          <TabsContent value="contacts" className="mt-4">
            {contactsLoading ? (
              <div className="bg-card p-4 rounded-xl border border-border">
                <SectionLoadingSkeleton label="Loading contacts" />
              </div>
            ) : contactsError ? (
              <div className="bg-card p-4 rounded-xl border border-border">
                <InlineSectionError
                  message="Could not load contacts."
                  onRetry={() => void loadSecondaryData()}
                />
              </div>
            ) : (
              <CampaignLeadsTab contacts={contacts} campaignId={campaignId} userId={userId} workspaceId={currentWorkspaceId} onRefresh={loadSecondaryData} />
            )}
          </TabsContent>

          <TabsContent value="qr" className="mt-4 space-y-4">
            <div className="bg-card p-4 rounded-xl border border-border">
              <h3 className="text-sm font-semibold text-foreground mb-3">QR Destination</h3>
              <div className="flex gap-3 flex-wrap">
                <input
                  type="url"
                  id="campaign-destination-url"
                  placeholder="https://youtube.com/watch?v=..."
                  className="flex-1 min-w-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={destinationUrl}
                  onChange={(e) => setDestinationUrl(e.target.value)}
                />
                <Button onClick={handleSaveUrl} disabled={isSavingUrl} size="sm">
                  {isSavingUrl ? 'Saving...' : 'Link URL'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Where users go when they scan. Leave empty to use the Welcome page.
              </p>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="bg-card p-4 rounded-xl border border-border">
                <div className="flex flex-wrap gap-6 items-start justify-between">
                  <div className="flex flex-col gap-3">
                    <h3 className="text-sm font-semibold text-foreground">Basic QR Code</h3>
                    <p className="text-xs text-muted-foreground max-w-md">
                      One QR code for the whole campaign. Each scan is tracked in campaign analytics, but not tied to any specific address.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <Button
                        onClick={handleGenerateBasicQr}
                        disabled={generatingBasicQr}
                      >
                        {generatingBasicQr ? 'Generating...' : 'Generate QR'}
                      </Button>
                    </div>
                  </div>
                  {basicQrBase64 && (
                    <div className="flex flex-col gap-2 items-center shrink-0">
                      <img
                        src={basicQrBase64}
                        alt="Campaign basic QR code"
                        className="w-48 h-48 rounded-lg border border-border bg-white object-contain"
                      />
                      <button
                        type="button"
                        onClick={handleDownloadBasicQr}
                        className="text-sm font-medium text-red-600 hover:text-red-500 underline underline-offset-2"
                      >
                        Download PNG
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="bg-card p-4 rounded-xl border border-border">
                <h2 className="text-sm font-semibold text-foreground mb-3">Advanced QR Code</h2>
                <p className="text-xs text-muted-foreground mb-3">
                  Unique QR codes for every home in the campaign. Scans are tied to addresses and each PNG includes the home address for print matching.
                </p>
                {!addressesLoading && formattedRecipients.length === 0 ? (
                  <p className="mb-3 text-xs text-muted-foreground">
                    Add addresses to this campaign before generating QR codes.
                  </p>
                ) : !addressesLoading && !hasGeneratedAdvancedQr ? (
                  <p className="mb-3 text-xs text-muted-foreground">
                    QR codes have not been generated yet.
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-3">
                  <Button
                    onClick={() => handleGenerateQRs(true)}
                    disabled={generating || addressesLoading || formattedRecipients.length === 0}
                  >
                    {generating ? 'Generating...' : 'Generate QR Codes'}
                  </Button>
                  {generating ? (
                    <p className="text-xs text-muted-foreground">
                      Generating QR codes, this may take up to 30 seconds...
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="bg-card p-4 rounded-xl border border-border">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">QR Analytics</h2>
                  <p className="text-xs text-muted-foreground">
                    Simple scan totals for this campaign.
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={loadData}>
                  Refresh
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground mb-3">
                Basic QR scans count toward total scans, not homes scanned.
              </p>
              {scanEventsLoading ? (
                <p className="mb-3 text-xs text-muted-foreground">Loading scan totals…</p>
              ) : scanEventsError ? (
                <div className="mb-3">
                  <InlineSectionError
                    message="Could not load scan totals."
                    onRetry={() => void loadSecondaryData()}
                  />
                </div>
              ) : null}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-lg border border-border bg-background p-3">
                  <p className="text-xs text-muted-foreground">Homes in campaign</p>
                  <p className="text-2xl font-semibold text-foreground">{totalHomesInCampaign.toLocaleString()}</p>
                </div>
                <div className="rounded-lg border border-border bg-background p-3">
                  <p className="text-xs text-muted-foreground">Homes scanned (Advanced QR)</p>
                  <p className="text-2xl font-semibold text-foreground">{homesWithQrScans.toLocaleString()}</p>
                </div>
                <div className="rounded-lg border border-border bg-background p-3">
                  <p className="text-xs text-muted-foreground">Total QR scans</p>
                  <p className="text-2xl font-semibold text-foreground">{totalQrScans.toLocaleString()}</p>
                </div>
              </div>
              {qrScanEventsCount === null && (
                <p className="text-[11px] text-muted-foreground mt-2">
                  Total scans shown with fallback estimate when event logs are unavailable.
                </p>
              )}
            </div>

            <div className="bg-card p-4 rounded-xl border border-border">
              <h3 className="text-sm font-semibold text-foreground">Homes Scanned (Advanced)</h3>
              <p className="text-xs text-muted-foreground mt-1 mb-3">
                Most recent homes that scanned an advanced QR code.
              </p>
              {advancedHomesScanned.length === 0 ? (
                <p className="text-xs text-muted-foreground">No advanced QR scans yet.</p>
              ) : (
                <div className="space-y-2">
                  {advancedHomesScanned.map((addr) => {
                    const addressText =
                      (addr.house_number && addr.street_name)
                        ? `${addr.house_number} ${addr.street_name}`
                        : (addr.address || addr.formatted || 'Unknown address');
                    const lastScanned = addr.last_scanned_at
                      ? new Date(addr.last_scanned_at).toLocaleString()
                      : 'Unknown';
                    return (
                      <div
                        key={addr.id}
                        className="rounded-md border border-border bg-background px-3 py-2 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm text-foreground truncate">{addressText}</p>
                          <p className="text-[11px] text-muted-foreground">Last scan: {lastScanned}</p>
                        </div>
                        <p className="text-xs font-medium text-foreground whitespace-nowrap">
                          {(addr.scans || 0).toLocaleString()} scan{(addr.scans || 0) === 1 ? '' : 's'}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="finance" className="mt-4">
            <FinancePanel
              targetType="campaign"
              targetId={campaignId}
              workspaceId={campaign?.workspace_id ?? currentWorkspaceId}
              addresses={addresses}
            />
          </TabsContent>

          <TabsContent value="assignments" className="mt-4" data-self-serve-demo-allow="true">
            <CampaignAssignmentView
              campaignId={campaignId}
              campaignName={campaign?.name ?? undefined}
              addresses={addresses}
              demoMode={isSelfServeDemo}
              onDemoSplitComplete={handleDemoSplitComplete}
            />
          </TabsContent>

          <TabsContent value="notes" className="mt-4 space-y-4">
            <div className="bg-card p-4 rounded-xl border border-border">
              <h2 className="text-sm font-semibold text-foreground mb-3">Campaign notes</h2>
              <Textarea
                className="min-h-[120px] resize-y"
                placeholder="Write a note..."
                value={campaignNoteDraft}
                onChange={(event) => setCampaignNoteDraft(event.target.value)}
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <label className="inline-flex cursor-pointer items-center">
                    <input
                      key={campaignNotePdfInputKey}
                      type="file"
                      accept="application/pdf"
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.target.files?.[0] ?? null;
                        if (file && file.type !== 'application/pdf') {
                          alert('Invalid file type. Use a PDF.');
                          setCampaignNotePdf(null);
                          setCampaignNotePdfInputKey((value) => value + 1);
                          return;
                        }
                        setCampaignNotePdf(file);
                      }}
                      disabled={isSavingNotes}
                    />
                    <span className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground">
                      <Paperclip className="h-4 w-4" />
                      Add PDF
                    </span>
                  </label>
                  {campaignNotePdf ? (
                    <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
                      <FileText className="h-3.5 w-3.5 shrink-0" />
                      <span className="max-w-[220px] truncate">{campaignNotePdf.name}</span>
                      <button
                        type="button"
                        className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                        aria-label="Remove PDF"
                        onClick={() => {
                          setCampaignNotePdf(null);
                          setCampaignNotePdfInputKey((value) => value + 1);
                        }}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : null}
                </div>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleAddCampaignNote}
                  disabled={!canAddCampaignNote || isSavingNotes}
                >
                  <Plus className="h-4 w-4" />
                  {isSavingNotes ? 'Saving...' : 'Add note'}
                </Button>
              </div>
            </div>

            {sortedCampaignNoteEntries.length > 0 ? (
              <div className="space-y-0">
                {sortedCampaignNoteEntries.map((entry, index) => (
                  <div key={entry.id} className="relative pl-7 pb-5 last:pb-0">
                    {index < sortedCampaignNoteEntries.length - 1 ? (
                      <span className="absolute left-[7px] top-5 h-[calc(100%-1.25rem)] w-px bg-border" />
                    ) : null}
                    <span className="absolute left-0 top-1.5 h-3.5 w-3.5 rounded-full border border-primary bg-background" />
                    <div className="rounded-lg border border-border bg-card p-4">
                      <time className="font-mono text-xs text-muted-foreground">
                        {formatCampaignNoteTimestamp(entry.createdAt)}
                      </time>
                      {entry.body ? (
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">{entry.body}</p>
                      ) : null}
                      {entry.attachment ? (
                        <a
                          href={entry.attachment.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-3 inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-primary hover:bg-accent hover:text-accent-foreground"
                        >
                          <FileText className="h-4 w-4 shrink-0" />
                          <span className="truncate">{entry.attachment.name}</span>
                        </a>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-card/60 p-6 text-sm text-muted-foreground">
                No notes yet.
              </div>
            )}

          </TabsContent>
        </Tabs>
      </main>

      <PaywallGuard open={showPaywall} onClose={() => setShowPaywall(false)} />
      <MissingQRModal
        open={showMissingQRModal}
        onClose={() => {
          setShowMissingQRModal(false);
          setMissingQRFlyerId(null);
        }}
        onAddQR={handleAddQR}
      />
    </div>
  );
}
