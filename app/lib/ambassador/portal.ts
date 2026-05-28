export const AMBASSADOR_LANDING_DEFAULTS = {
  headline: 'Door knocking and farm tracking built for serious prospectors.',
  subline:
    'I use FLYR to organize field prospecting, track doors, and turn real-world activity into measurable results.',
  introMessage:
    'I use FLYR to organize field prospecting, track doors, and turn real-world activity into measurable results.',
  ctaText: 'Start 14 day free trial',
  offerText: 'Use my link to get 14 days free and see how FLYR tracks real field activity.',
} as const;

export const FLYR_PUBLIC_ORIGIN = 'https://flyr.software';

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

export function withOrigin(origin: string, path: string): string {
  return `${origin.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

export function withFlyrOrigin(path: string): string {
  return withOrigin(FLYR_PUBLIC_ORIGIN, path);
}
