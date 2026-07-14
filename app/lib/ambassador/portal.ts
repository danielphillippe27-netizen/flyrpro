export const AMBASSADOR_LANDING_DEFAULTS = {
  headline: 'Door knocking and farm tracking built for serious prospectors.',
  subline:
    'I use WolfGrid to organize field prospecting, track doors, and turn real-world activity into measurable results.',
  introMessage:
    'I use WolfGrid to organize field prospecting, track doors, and turn real-world activity into measurable results.',
  ctaText: 'Start with one campaign included',
  offerText: 'Use my link to get one workspace campaign included and see how WolfGrid tracks real field activity.',
} as const;

export const FLYR_PUBLIC_ORIGIN = 'https://wolfgrid.app';
export const AMBASSADOR_RE_TEAM_SOURCE = 'ambassador';
export const AMBASSADOR_RE_TEAM_CAMPAIGN = 're-team';
export const AMBASSADOR_RE_TEAM_DEMO_VIDEO_URL =
  'https://d34c49t0gfk0ai.cloudfront.net/demo-video/demo-video.mp4';

export const AMBASSADOR_RE_TEAM_LANDING_COPY = {
  headline: 'Field prospecting built for real estate teams.',
  introMessage:
    'Give every agent a clear territory, track every door, and turn real-world prospecting into team visibility.',
  offerText:
    'Watch the demo, then start with one workspace campaign included through this ambassador link.',
} as const;

export const AMBASSADOR_RESERVED_SLUGS = new Set([
  'admin',
  'api',
  'a',
  'ambassadors',
  'ambassador',
  'ambassador-dashboard',
  'codex-live-campaign',
  'dashboard',
  'download',
  'download-ios',
  'editor',
  'editor-canva',
  'farms',
  'join',
  'l',
  'billing',
  'onboarding',
  'p',
  'partner-offer',
  'plans',
  'privacy',
  'q',
  'reset-password',
  'settings',
  'login',
  'signup',
  'subscribe',
  'terms',
  'test',
  'test-deploy',
  'thank-you',
  'welcome',
]);

export function normalizePartnerSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export function isReservedPartnerSlug(slug: string): boolean {
  return AMBASSADOR_RESERVED_SLUGS.has(slug);
}

export function sanitizeTrackingParam(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return null;
  return trimmed.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || null;
}

export function buildAmbassadorSharePath(referralCode: string, source?: string | null, campaign?: string | null): string {
  const params = new URLSearchParams();
  const normalizedSource = sanitizeTrackingParam(source);
  const normalizedCampaign = sanitizeTrackingParam(campaign);
  if (normalizedSource) params.set('source', normalizedSource);
  if (normalizedCampaign) params.set('campaign', normalizedCampaign);
  const query = params.toString();
  return `/a/${encodeURIComponent(referralCode)}${query ? `?${query}` : ''}`;
}

export function buildPublicLandingPath(slug: string, source?: string | null, campaign?: string | null): string {
  const params = new URLSearchParams();
  const normalizedSource = sanitizeTrackingParam(source);
  const normalizedCampaign = sanitizeTrackingParam(campaign);
  if (normalizedSource) params.set('source', normalizedSource);
  if (normalizedCampaign) params.set('campaign', normalizedCampaign);
  const query = params.toString();
  return `/${encodeURIComponent(slug)}${query ? `?${query}` : ''}`;
}

export function buildLegacyPublicLandingPath(slug: string, source?: string | null, campaign?: string | null): string {
  const params = new URLSearchParams();
  const normalizedSource = sanitizeTrackingParam(source);
  const normalizedCampaign = sanitizeTrackingParam(campaign);
  if (normalizedSource) params.set('source', normalizedSource);
  if (normalizedCampaign) params.set('campaign', normalizedCampaign);
  const query = params.toString();
  return `/p/${encodeURIComponent(slug)}${query ? `?${query}` : ''}`;
}

export function buildAmbassadorReTeamLandingPath(slug: string): string {
  return buildPublicLandingPath(slug, AMBASSADOR_RE_TEAM_SOURCE, AMBASSADOR_RE_TEAM_CAMPAIGN);
}

export function withOrigin(origin: string, path: string): string {
  return `${origin.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

export function withFlyrOrigin(path: string): string {
  return withOrigin(FLYR_PUBLIC_ORIGIN, path);
}
