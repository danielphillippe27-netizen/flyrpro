export type IntegrationProviderId =
  | 'followupboss'
  | 'boldtrail'
  | 'hubspot'
  | 'monday'
  | 'zapier'
  | 'jobnimbus'
  | 'companycam'
  | 'jobber'
  | 'acculynx'
  | 'sumoquote'
  | 'rooflink';

export type IntegrationAuthMode = 'oauth' | 'api_key' | 'webhook';

export type IntegrationIndustryGroup = 'real_estate' | 'contractor';

export type IntegrationCatalogEntry = {
  id: IntegrationProviderId;
  displayName: string;
  description: string;
  industryGroup: IntegrationIndustryGroup;
  authModes: IntegrationAuthMode[];
  preferredAuthMode: IntegrationAuthMode;
  tokenLabel?: string;
  tokenPlaceholder?: string;
  accent: 'blue' | 'emerald' | 'orange' | 'yellow' | 'slate' | 'cyan' | 'violet' | 'rose';
};

export const REAL_ESTATE_INTEGRATIONS: IntegrationCatalogEntry[] = [
  {
    id: 'followupboss',
    displayName: 'Follow Up Boss',
    description: 'Sync your leads directly to Follow Up Boss CRM.',
    industryGroup: 'real_estate',
    authModes: ['oauth', 'api_key'],
    preferredAuthMode: 'oauth',
    accent: 'blue',
  },
  {
    id: 'zapier',
    displayName: 'Zapier',
    description: 'Route FLYR leads anywhere with a Zapier Catch Hook.',
    industryGroup: 'real_estate',
    authModes: ['webhook'],
    preferredAuthMode: 'webhook',
    accent: 'orange',
  },
  {
    id: 'hubspot',
    displayName: 'HubSpot',
    description: 'Sync FLYR leads into HubSpot contacts.',
    industryGroup: 'real_estate',
    authModes: ['oauth'],
    preferredAuthMode: 'oauth',
    accent: 'orange',
  },
  {
    id: 'boldtrail',
    displayName: 'BoldTrail / kvCORE',
    description: 'Token-based BoldTrail lead sync from FLYR.',
    industryGroup: 'real_estate',
    authModes: ['api_key'],
    preferredAuthMode: 'api_key',
    tokenLabel: 'API Token',
    tokenPlaceholder: 'Paste your BoldTrail API token',
    accent: 'emerald',
  },
  {
    id: 'monday',
    displayName: 'Monday.com',
    description: 'Sync FLYR leads into a selected monday.com board.',
    industryGroup: 'real_estate',
    authModes: ['oauth'],
    preferredAuthMode: 'oauth',
    accent: 'yellow',
  },
];

export const CONTRACTOR_INTEGRATIONS: IntegrationCatalogEntry[] = [
  {
    id: 'jobnimbus',
    displayName: 'JobNimbus',
    description: 'Create contacts or jobs in JobNimbus from FLYR leads.',
    industryGroup: 'contractor',
    authModes: ['api_key'],
    preferredAuthMode: 'api_key',
    tokenLabel: 'API Key',
    tokenPlaceholder: 'Paste your JobNimbus API key',
    accent: 'blue',
  },
  {
    id: 'companycam',
    displayName: 'CompanyCam',
    description: 'Create CompanyCam projects from FLYR lead addresses.',
    industryGroup: 'contractor',
    authModes: ['oauth', 'api_key'],
    preferredAuthMode: 'oauth',
    tokenLabel: 'Access Token',
    tokenPlaceholder: 'Paste a CompanyCam access token',
    accent: 'cyan',
  },
  {
    id: 'jobber',
    displayName: 'Jobber',
    description: 'Create Jobber clients from FLYR lead records.',
    industryGroup: 'contractor',
    authModes: ['oauth'],
    preferredAuthMode: 'oauth',
    accent: 'emerald',
  },
  {
    id: 'acculynx',
    displayName: 'AccuLynx',
    description: 'Send FLYR leads into AccuLynx for roofing sales workflows.',
    industryGroup: 'contractor',
    authModes: ['api_key'],
    preferredAuthMode: 'api_key',
    tokenLabel: 'API Key',
    tokenPlaceholder: 'Paste your AccuLynx API key',
    accent: 'violet',
  },
  {
    id: 'sumoquote',
    displayName: 'SumoQuote',
    description: 'Create SumoQuote projects from FLYR lead opportunities.',
    industryGroup: 'contractor',
    authModes: ['oauth', 'api_key'],
    preferredAuthMode: 'oauth',
    tokenLabel: 'API Key',
    tokenPlaceholder: 'Paste your SumoQuote API key',
    accent: 'rose',
  },
  {
    id: 'rooflink',
    displayName: 'RoofLink',
    description: 'Create RoofLink jobs from FLYR lead records.',
    industryGroup: 'contractor',
    authModes: ['api_key'],
    preferredAuthMode: 'api_key',
    tokenLabel: 'API Key',
    tokenPlaceholder: 'Paste your RoofLink API key',
    accent: 'slate',
  },
];

export const ALL_INTEGRATIONS = [
  ...REAL_ESTATE_INTEGRATIONS,
  ...CONTRACTOR_INTEGRATIONS,
] as const;

export const CONTRACTOR_PROVIDER_IDS = [
  'jobnimbus',
  'companycam',
  'jobber',
  'acculynx',
  'sumoquote',
  'rooflink',
] as const satisfies readonly IntegrationProviderId[];

export function normalizeIndustry(industry: string | null | undefined): string {
  return (industry ?? '').trim().toLowerCase();
}

export function isRealEstateIndustry(industry: string | null | undefined): boolean {
  return normalizeIndustry(industry) === 'real estate';
}

export function getIntegrationsForIndustry(industry: string | null | undefined): IntegrationCatalogEntry[] {
  return isRealEstateIndustry(industry) ? REAL_ESTATE_INTEGRATIONS : CONTRACTOR_INTEGRATIONS;
}

export function normalizeIntegrationProvider(value: string | null | undefined): IntegrationProviderId | null {
  const provider = (value ?? '').trim().toLowerCase().replace(/[_\s-]+/g, '');
  if (!provider) return null;
  if (provider === 'fub' || provider === 'followupboss') return 'followupboss';
  if (provider === 'boldtrail' || provider === 'kvcore') return 'boldtrail';
  if (provider === 'monday' || provider === 'mondaycom') return 'monday';
  if (provider === 'companycam' || provider === 'companycamera') return 'companycam';
  if (provider === 'jobnimbus') return 'jobnimbus';
  if (provider === 'jobber') return 'jobber';
  if (provider === 'acculynx') return 'acculynx';
  if (provider === 'sumoquote') return 'sumoquote';
  if (provider === 'rooflink') return 'rooflink';
  if (provider === 'hubspot') return 'hubspot';
  if (provider === 'zapier') return 'zapier';
  return null;
}

export function findIntegration(provider: string | null | undefined): IntegrationCatalogEntry | null {
  const id = normalizeIntegrationProvider(provider);
  if (!id) return null;
  return ALL_INTEGRATIONS.find((entry) => entry.id === id) ?? null;
}
