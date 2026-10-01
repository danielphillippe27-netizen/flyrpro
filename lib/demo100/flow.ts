import {
  allocateSelfServeDoorOutcomeCounts,
  buildSelfServeDoorOutcomes,
  type SelfServeDoorOutcome,
} from '@/lib/demo/selfServeDoorOutcomes';

export const DEMO100_STAGES = [
  'intro_video',
  'campaign_builder',
  'territory_preview',
  'post_create_video',
  'branch_choice',
  'team_video',
  'solo_video',
  'magic_video',
  'end_video',
  'campaign_results',
  'assignments',
  'live_map',
  'team_stats',
  'field_guide_intro_video',
  'iphone_chapters',
  'outro_video',
  'cta',
  'solo_live_map',
  'solo_stats',
] as const;

export type Demo100Stage = (typeof DEMO100_STAGES)[number];

export type Demo100Metrics = {
  doors: number;
  noAnswers: number;
  conversations: number;
  leads: number;
  appointments: number;
  conversationRate: number;
};

export type Demo100Member = {
  id: string;
  name: string;
  color: string;
};

export const DEMO100_MEMBERS: readonly Demo100Member[] = [
  { id: 'demo100-maya', name: 'Maya', color: '#ef4444' },
  { id: 'demo100-leo', name: 'Leo', color: '#2563eb' },
  { id: 'demo100-ava', name: 'Ava', color: '#a16207' },
  { id: 'demo100-noah', name: 'Noah', color: '#7c3aed' },
] as const;

export const DEMO100_SESSION_STORAGE_KEY = 'wolfgrid.demo100.session.v2';
export const SELF_SERVE_CAMPAIGN_DRAFT_PRIMARY_KEY = 'wolfgrid.selfServeCampaignDraft';
export const SELF_SERVE_CAMPAIGN_DRAFT_KEY = 'flyr.selfServeCampaignDraft';

export type Demo100StoredState = {
  version: 2;
  stage: Demo100Stage;
  selectedCount: number;
  campaignName: string;
  polygon: GeoJSON.Polygon | null;
  bbox: number[] | null;
  createdAt: string | null;
};

export function isDemo100Stage(value: unknown): value is Demo100Stage {
  return typeof value === 'string' && DEMO100_STAGES.includes(value as Demo100Stage);
}

export function nextDemo100Stage(stage: Demo100Stage): Demo100Stage {
  if (stage === 'post_create_video') return 'campaign_results';
  if (stage === 'branch_choice') return 'team_video';
  if (stage === 'team_video') return 'field_guide_intro_video';
  if (stage === 'solo_video') return 'cta';
  if (stage === 'magic_video') return 'end_video';
  if (stage === 'end_video') return 'cta';
  const sequence = DEMO100_STAGES.filter(
    (candidate) => !['branch_choice', 'team_video', 'solo_video', 'magic_video', 'end_video', 'solo_live_map', 'solo_stats'].includes(candidate),
  );
  const index = sequence.indexOf(stage);
  return sequence[Math.min(index + 1, sequence.length - 1)] ?? 'cta';
}

export function nextDemo1Stage(stage: Demo100Stage): Demo100Stage {
  if (stage === 'post_create_video') return 'branch_choice';
  if (stage === 'team_video') return 'assignments';
  if (stage === 'solo_video') return 'solo_live_map';
  if (stage === 'solo_live_map') return 'solo_stats';
  if (stage === 'solo_stats' || stage === 'team_stats') return 'magic_video';
  if (stage === 'magic_video') return 'end_video';
  if (stage === 'end_video') return 'cta';
  return nextDemo100Stage(stage);
}

export function getDemo100Outcomes(total: number): SelfServeDoorOutcome[] {
  return buildSelfServeDoorOutcomes(Math.max(0, Math.trunc(total)));
}

export function getDemo100Metrics(total: number): Demo100Metrics {
  const safeTotal = Math.max(0, Math.trunc(total));
  const counts = allocateSelfServeDoorOutcomeCounts(safeTotal);
  const conversations = counts.answered + counts.lead + counts.appointment;
  const leads = counts.lead + counts.appointment;

  return {
    doors: safeTotal,
    noAnswers: counts.no_answer,
    conversations,
    leads,
    appointments: counts.appointment,
    conversationRate: safeTotal > 0 ? conversations / safeTotal : 0,
  };
}

export function balancedDemo100ZoneIndex(index: number, total: number, memberCount = DEMO100_MEMBERS.length): number {
  if (memberCount <= 1 || total <= 1) return 0;
  return Math.min(memberCount - 1, Math.floor((Math.max(0, index) * memberCount) / total));
}

export function getDemo100StageNumber(stage: Demo100Stage): number {
  if (stage === 'cta') return 9;
  if (stage === 'intro_video') return 1;
  if (stage === 'campaign_builder') return 2;
  if (stage === 'territory_preview' || stage === 'post_create_video') return 3;
  if (stage === 'branch_choice' || stage === 'team_video' || stage === 'solo_video') return 4;
  if (stage === 'magic_video') return 8;
  if (stage === 'end_video') return 9;
  if (stage === 'campaign_results') return 4;
  if (stage === 'assignments') return 5;
  if (stage === 'live_map') return 6;
  if (stage === 'team_stats') return 7;
  if (stage === 'solo_live_map') return 6;
  if (stage === 'solo_stats') return 7;
  if (stage === 'field_guide_intro_video' || stage === 'iphone_chapters') return 8;
  return 9;
}

export function parseDemo100StoredState(value: string | null): Demo100StoredState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<Demo100StoredState>;
    if (parsed.version !== 2 || !isDemo100Stage(parsed.stage)) return null;
    const polygon = parsed.polygon?.type === 'Polygon' ? parsed.polygon : null;
    return {
      version: 2,
      stage: parsed.stage,
      selectedCount: Math.max(0, Math.trunc(Number(parsed.selectedCount) || 0)),
      campaignName: typeof parsed.campaignName === 'string' && parsed.campaignName.trim()
        ? parsed.campaignName.trim().slice(0, 120)
        : 'FIRST CAMPAIGN',
      polygon,
      bbox: Array.isArray(parsed.bbox) ? parsed.bbox.map(Number).filter(Number.isFinite) : null,
      createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : null,
    };
  } catch {
    return null;
  }
}
