import crypto from 'crypto';
import { createHmac, randomBytes } from 'crypto';
import { getCrmEncryptionKey, getOAuthStateSecret } from '@/app/api/integrations/_lib/env';
import {
  CONTRACTOR_INTEGRATIONS,
  CONTRACTOR_PROVIDER_IDS,
  type IntegrationProviderId,
  normalizeIntegrationProvider,
} from '@/lib/integrations/catalog';

export type ContractorProviderId = (typeof CONTRACTOR_PROVIDER_IDS)[number];

export type ContractorLeadPayload = {
  id?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  notes?: string | null;
  source?: string | null;
  campaignId?: string | null;
  createdAt?: string | null;
};

export type ContractorAuth = {
  mode: 'api_key' | 'oauth';
  token: string;
};

export type ContractorSyncResult = {
  remoteObjectId: string;
  remoteObjectType: string;
  raw: unknown;
};

type OAuthConfig = {
  clientIdEnv: string;
  clientSecretEnv: string;
  authorizeUrlEnv: string;
  tokenUrlEnv: string;
  defaultAuthorizeUrl: string;
  defaultTokenUrl: string;
  defaultScope?: string;
  scopeEnv?: string;
  extraAuthorizeParams?: Record<string, string>;
};

type ProviderConfig = {
  id: ContractorProviderId;
  displayName: string;
  apiBaseEnv: string;
  defaultApiBase: string;
  apiKeyHeader: (token: string) => Record<string, string>;
  test: {
    method?: 'GET' | 'POST';
    path: string;
    body?: unknown;
  };
  oauth?: OAuthConfig;
};

const providerConfigs: Record<ContractorProviderId, ProviderConfig> = {
  jobnimbus: {
    id: 'jobnimbus',
    displayName: 'JobNimbus',
    apiBaseEnv: 'JOBNIMBUS_API_BASE',
    defaultApiBase: 'https://app.jobnimbus.com/api1',
    apiKeyHeader: bearerHeader,
    test: { path: '/contacts?limit=1' },
  },
  companycam: {
    id: 'companycam',
    displayName: 'CompanyCam',
    apiBaseEnv: 'COMPANYCAM_API_BASE',
    defaultApiBase: 'https://api.companycam.com/v2',
    apiKeyHeader: bearerHeader,
    test: { path: '/projects?page=1&per_page=1' },
    oauth: {
      clientIdEnv: 'COMPANYCAM_OAUTH_CLIENT_ID',
      clientSecretEnv: 'COMPANYCAM_OAUTH_CLIENT_SECRET',
      authorizeUrlEnv: 'COMPANYCAM_OAUTH_AUTHORIZE_URL',
      tokenUrlEnv: 'COMPANYCAM_OAUTH_TOKEN_URL',
      defaultAuthorizeUrl: 'https://app.companycam.com/oauth/authorize',
      defaultTokenUrl: 'https://api.companycam.com/v2/oauth/token',
      scopeEnv: 'COMPANYCAM_OAUTH_SCOPE',
      defaultScope: 'read write',
    },
  },
  jobber: {
    id: 'jobber',
    displayName: 'Jobber',
    apiBaseEnv: 'JOBBER_API_BASE',
    defaultApiBase: 'https://api.getjobber.com/api/graphql',
    apiKeyHeader: bearerHeader,
    test: {
      method: 'POST',
      path: '',
      body: { query: 'query FlyrConnectionTest { clients(first: 1) { nodes { id } } }' },
    },
    oauth: {
      clientIdEnv: 'JOBBER_OAUTH_CLIENT_ID',
      clientSecretEnv: 'JOBBER_OAUTH_CLIENT_SECRET',
      authorizeUrlEnv: 'JOBBER_OAUTH_AUTHORIZE_URL',
      tokenUrlEnv: 'JOBBER_OAUTH_TOKEN_URL',
      defaultAuthorizeUrl: 'https://api.getjobber.com/api/oauth/authorize',
      defaultTokenUrl: 'https://api.getjobber.com/api/oauth/token',
      scopeEnv: 'JOBBER_OAUTH_SCOPE',
      defaultScope: 'read_clients write_clients',
    },
  },
  acculynx: {
    id: 'acculynx',
    displayName: 'AccuLynx',
    apiBaseEnv: 'ACCULYNX_API_BASE',
    defaultApiBase: 'https://api.acculynx.com/api/v2',
    apiKeyHeader: (token) => ({
      Authorization: `Bearer ${token}`,
      'x-api-key': token,
    }),
    test: { path: '/jobs?pageSize=1' },
  },
  sumoquote: {
    id: 'sumoquote',
    displayName: 'SumoQuote',
    apiBaseEnv: 'SUMOQUOTE_API_BASE',
    defaultApiBase: 'https://api.sumoquote.com/v2',
    apiKeyHeader: (token) => ({
      'sq-api-key': token,
    }),
    test: { path: '/User' },
    oauth: {
      clientIdEnv: 'SUMOQUOTE_OAUTH_CLIENT_ID',
      clientSecretEnv: 'SUMOQUOTE_OAUTH_CLIENT_SECRET',
      authorizeUrlEnv: 'SUMOQUOTE_OAUTH_AUTHORIZE_URL',
      tokenUrlEnv: 'SUMOQUOTE_OAUTH_TOKEN_URL',
      defaultAuthorizeUrl: 'https://sumoquote.auth0.com/authorize',
      defaultTokenUrl: 'https://sumoquote.auth0.com/oauth/token',
      scopeEnv: 'SUMOQUOTE_OAUTH_SCOPE',
      defaultScope: 'openid profile email offline_access',
      extraAuthorizeParams: {
        audience: process.env.SUMOQUOTE_OAUTH_AUDIENCE ?? 'https://api.sumoquote.com',
      },
    },
  },
  rooflink: {
    id: 'rooflink',
    displayName: 'RoofLink',
    apiBaseEnv: 'ROOFLINK_API_BASE',
    defaultApiBase: 'https://integrate.rooflink.com/roof_link_endpoints/api',
    apiKeyHeader: (token) => ({
      Authorization: `Api-Key ${token}`,
    }),
    test: { path: '/light/jobs/' },
  },
};

function bearerHeader(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export function isContractorProvider(value: string | null | undefined): value is ContractorProviderId {
  const provider = normalizeIntegrationProvider(value);
  return !!provider && CONTRACTOR_PROVIDER_IDS.includes(provider as ContractorProviderId);
}

export function getContractorProvider(value: string | null | undefined): ProviderConfig | null {
  const provider = normalizeIntegrationProvider(value);
  if (!isContractorProvider(provider)) return null;
  return providerConfigs[provider];
}

export function getContractorDisplayName(provider: ContractorProviderId): string {
  return CONTRACTOR_INTEGRATIONS.find((entry) => entry.id === provider)?.displayName ?? provider;
}

export function encryptContractorSecret(secret: string): string {
  const keyString = getCrmEncryptionKey();
  const key = Buffer.from(keyString.slice(0, 32));
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(secret, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const authTag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted}`;
}

export function decryptContractorSecret(encryptedData: string): string {
  const keyString = getCrmEncryptionKey();
  const key = Buffer.from(keyString.slice(0, 32));
  const parts = encryptedData.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted data format');
  }

  const iv = Buffer.from(parts[0], 'base64');
  const authTag = Buffer.from(parts[1], 'base64');
  const encrypted = parts[2];
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export async function getContractorAuthForWorkspace(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  workspaceId: string,
  provider: ContractorProviderId
): Promise<ContractorAuth | null> {
  const { data: oauth } = await supabase
    .from('user_integrations')
    .select('access_token, provider_config')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle();

  const oauthToken = typeof oauth?.access_token === 'string' ? oauth.access_token.trim() : '';
  if (oauthToken) {
    return { mode: 'oauth', token: oauthToken };
  }

  const { data: connection } = await supabase
    .from('crm_connections')
    .select('api_key_encrypted')
    .eq('workspace_id', workspaceId)
    .eq('provider', provider)
    .eq('status', 'connected')
    .maybeSingle();

  if (!connection?.api_key_encrypted) return null;
  return {
    mode: 'api_key',
    token: decryptContractorSecret(connection.api_key_encrypted),
  };
}

export async function testContractorConnection(provider: ContractorProviderId, auth: ContractorAuth): Promise<unknown> {
  const config = providerConfigs[provider];
  const url = buildProviderUrl(config, config.test.path);
  return requestProviderJson(config, auth, url, {
    method: config.test.method ?? 'GET',
    body: config.test.body ? JSON.stringify(config.test.body) : undefined,
  });
}

export async function pushContractorLead(
  provider: ContractorProviderId,
  auth: ContractorAuth,
  lead: ContractorLeadPayload
): Promise<ContractorSyncResult> {
  if (provider === 'jobber') {
    return pushJobberLead(auth, lead);
  }

  const config = providerConfigs[provider];
  const endpoint = buildCreateEndpoint(provider);
  const payload = buildCreatePayload(provider, lead);
  const raw = await requestProviderJson(config, auth, buildProviderUrl(config, endpoint.path), {
    method: endpoint.method,
    body: JSON.stringify(payload),
  });
  const remoteObjectId = extractRemoteId(raw) ?? `${provider}-${Date.now()}`;
  return {
    remoteObjectId,
    remoteObjectType: endpoint.remoteObjectType,
    raw,
  };
}

function buildCreateEndpoint(provider: ContractorProviderId): {
  method: 'POST';
  path: string;
  remoteObjectType: string;
} {
  switch (provider) {
    case 'jobnimbus':
      return { method: 'POST', path: '/contacts', remoteObjectType: 'contact' };
    case 'companycam':
      return { method: 'POST', path: '/projects', remoteObjectType: 'project' };
    case 'acculynx':
      return { method: 'POST', path: '/jobs', remoteObjectType: 'job' };
    case 'sumoquote':
      return { method: 'POST', path: '/Projects', remoteObjectType: 'project' };
    case 'rooflink':
      return { method: 'POST', path: '/light/jobs/', remoteObjectType: 'job' };
    case 'jobber':
      return { method: 'POST', path: '', remoteObjectType: 'client' };
  }
}

function buildCreatePayload(provider: ContractorProviderId, lead: ContractorLeadPayload): Record<string, unknown> {
  const { firstName, lastName } = splitFullName(lead.name);
  const base = {
    source: lead.source ?? 'WolfGrid',
    external_id: lead.id ?? undefined,
    notes: lead.notes ?? undefined,
  };

  switch (provider) {
    case 'jobnimbus':
      return compactRecord({
        ...base,
        type: 'contact',
        record_type_name: process.env.JOBNIMBUS_RECORD_TYPE_NAME ?? 'Customer',
        status_name: process.env.JOBNIMBUS_STATUS_NAME ?? 'Lead',
        first_name: firstName,
        last_name: lastName,
        email: lead.email,
        mobile_phone: lead.phone,
        address_line1: lead.address,
      });
    case 'companycam':
      return compactRecord({
        name: lead.address || lead.name || 'WolfGridject',
        address: lead.address,
        primary_contact: compactRecord({
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
        }),
        notes: lead.notes,
      });
    case 'acculynx':
      return compactRecord({
        ...base,
        jobName: lead.name || lead.address || 'WolfGrid Lead',
        customer: compactRecord({
          firstName,
          lastName,
          email: lead.email,
          phone: lead.phone,
        }),
        address: lead.address,
      });
    case 'sumoquote':
      return compactRecord({
        ...base,
        name: lead.name || lead.address || 'WolfGridject',
        customerName: lead.name,
        customerEmail: lead.email,
        customerPhone: lead.phone,
        address: lead.address,
      });
    case 'rooflink':
      return compactRecord({
        ...base,
        customer_name: lead.name,
        customer_email: lead.email,
        customer_phone: lead.phone,
        address: lead.address,
        job_name: lead.name || lead.address || 'WolfGrid Job',
      });
    case 'jobber':
      return compactRecord(base);
  }
}

async function pushJobberLead(auth: ContractorAuth, lead: ContractorLeadPayload): Promise<ContractorSyncResult> {
  const config = providerConfigs.jobber;
  const { firstName, lastName } = splitFullName(lead.name);
  const mutation = `
    mutation FlyrCreateClient($input: ClientCreateInput!) {
      clientCreate(input: $input) {
        client { id }
        userErrors { message }
      }
    }
  `;
  const variables = {
    input: compactRecord({
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      emails: lead.email ? [{ address: lead.email }] : undefined,
      phones: lead.phone ? [{ number: lead.phone }] : undefined,
      billingAddress: lead.address ? { street1: lead.address } : undefined,
      notes: lead.notes,
    }),
  };
  const raw = await requestProviderJson(config, auth, buildProviderUrl(config, ''), {
    method: 'POST',
    body: JSON.stringify({ query: mutation, variables }),
  });
  const errors = extractJobberUserErrors(raw);
  if (errors.length) {
    throw new Error(errors.join('; '));
  }
  return {
    remoteObjectId: extractRemoteId(raw) ?? `jobber-${Date.now()}`,
    remoteObjectType: 'client',
    raw,
  };
}

async function requestProviderJson(
  config: ProviderConfig,
  auth: ContractorAuth,
  url: string,
  init: RequestInit
): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...config.apiKeyHeader(auth.token),
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  const body = text.trim() ? safeJsonParse(text) : null;
  if (!response.ok) {
    throw new Error(extractErrorMessage(body) || text.trim() || `${config.displayName} returned ${response.status}`);
  }
  return body;
}

function buildProviderUrl(config: ProviderConfig, path: string): string {
  const base = (process.env[config.apiBaseEnv] ?? config.defaultApiBase).trim().replace(/\/$/, '');
  if (!path) return base;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function splitFullName(name: string | null | undefined): { firstName: string; lastName: string } {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function compactRecord<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== null && item !== '')
  );
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function extractErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  for (const key of ['message', 'error', 'detail', 'title']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function extractRemoteId(payload: unknown): string | null {
  if (payload == null) return null;
  if (typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  for (const key of ['id', 'uid', 'uuid', 'jobId', 'job_id', 'projectId', 'project_id', 'clientId', 'client_id']) {
    const value = record[key];
    if (value != null && `${value}`.trim()) return `${value}`.trim();
  }
  for (const key of ['data', 'result', 'contact', 'job', 'project', 'client']) {
    const nested = extractRemoteId(record[key]);
    if (nested) return nested;
  }
  return null;
}

function extractJobberUserErrors(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const body = payload as Record<string, unknown>;
  const createResult = (body.data as Record<string, unknown> | undefined)?.clientCreate as
    | Record<string, unknown>
    | undefined;
  const userErrors = createResult?.userErrors;
  if (!Array.isArray(userErrors)) return [];
  return userErrors
    .map((error) => (error && typeof error === 'object' ? (error as Record<string, unknown>).message : null))
    .filter((message): message is string => typeof message === 'string' && message.trim().length > 0);
}

type OAuthStatePayload = {
  provider: ContractorProviderId;
  userId: string;
  workspaceId: string;
  platform: 'web' | 'ios';
  nonce: string;
  iat: number;
};

const OAUTH_STATE_TTL_SECONDS = 10 * 60;

export function providerSupportsOAuth(provider: ContractorProviderId): boolean {
  return !!providerConfigs[provider].oauth;
}

export function createContractorOAuthState(
  provider: ContractorProviderId,
  userId: string,
  workspaceId: string,
  platform: 'web' | 'ios'
): string {
  const payload: OAuthStatePayload = {
    provider,
    userId,
    workspaceId,
    platform,
    nonce: base64UrlEncode(randomBytes(12)),
    iat: Math.floor(Date.now() / 1000),
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  return `${encoded}.${signOAuthState(encoded)}`;
}

export function verifyContractorOAuthState(state: string): OAuthStatePayload | null {
  const [encoded, signature] = state.split('.');
  if (!encoded || !signature || signOAuthState(encoded) !== signature) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(encoded).toString('utf8')) as OAuthStatePayload;
    const provider = normalizeIntegrationProvider(payload.provider as IntegrationProviderId);
    if (!provider || !isContractorProvider(provider)) return null;
    if (!payload.userId || !payload.workspaceId || !payload.iat) return null;
    if (Math.floor(Date.now() / 1000) - payload.iat > OAUTH_STATE_TTL_SECONDS) return null;
    if (payload.platform !== 'web' && payload.platform !== 'ios') return null;
    return payload;
  } catch {
    return null;
  }
}

export function buildContractorAuthorizeUrl(
  provider: ContractorProviderId,
  state: string,
  redirectUri: string
): string {
  const oauth = ensureOAuthConfig(provider);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env[oauth.clientIdEnv] ?? '',
    redirect_uri: redirectUri,
    state,
  });
  const scope = process.env[oauth.scopeEnv ?? ''] ?? oauth.defaultScope ?? '';
  if (scope.trim()) params.set('scope', scope.trim());
  for (const [key, value] of Object.entries(oauth.extraAuthorizeParams ?? {})) {
    if (value) params.set(key, value);
  }
  return `${process.env[oauth.authorizeUrlEnv] ?? oauth.defaultAuthorizeUrl}?${params.toString()}`;
}

export async function exchangeContractorOAuthCode(
  provider: ContractorProviderId,
  code: string,
  redirectUri: string
): Promise<{ accessToken: string; refreshToken?: string | null; expiresAt?: number | null; raw: unknown }> {
  const oauth = ensureOAuthConfig(provider);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: process.env[oauth.clientIdEnv] ?? '',
    client_secret: process.env[oauth.clientSecretEnv] ?? '',
  });
  const response = await fetch(process.env[oauth.tokenUrlEnv] ?? oauth.defaultTokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const rawText = await response.text();
  const raw = rawText.trim() ? safeJsonParse(rawText) : {};
  if (!response.ok) {
    throw new Error(extractErrorMessage(raw) || rawText || `${getContractorDisplayName(provider)} token exchange failed`);
  }
  const record = raw as Record<string, unknown>;
  const accessToken = typeof record.access_token === 'string' ? record.access_token.trim() : '';
  if (!accessToken) throw new Error(`${getContractorDisplayName(provider)} did not return an access token`);
  const expiresIn = typeof record.expires_in === 'number' ? record.expires_in : null;
  return {
    accessToken,
    refreshToken: typeof record.refresh_token === 'string' ? record.refresh_token : null,
    expiresAt: expiresIn ? Math.floor(Date.now() / 1000) + expiresIn : null,
    raw,
  };
}

export function getContractorOAuthRedirectUri(provider: ContractorProviderId, origin?: string): string {
  const explicit = process.env[`${provider.toUpperCase()}_OAUTH_REDIRECT_URI`];
  if (explicit) return explicit;
  const appOrigin = resolveAppOrigin(origin);
  return `${appOrigin}/api/integrations/${provider}/oauth/callback`;
}

export function getContractorWebResultUrl(result: 'connected' | 'error', provider: ContractorProviderId, origin?: string): string {
  const appOrigin = resolveAppOrigin(origin);
  return `${appOrigin}/settings/integrations?${provider}=${result}`;
}

function ensureOAuthConfig(provider: ContractorProviderId): OAuthConfig {
  const oauth = providerConfigs[provider].oauth;
  if (!oauth) throw new Error(`${getContractorDisplayName(provider)} does not support OAuth in WolfGrid.`);
  if (!process.env[oauth.clientIdEnv] || !process.env[oauth.clientSecretEnv]) {
    throw new Error(`${getContractorDisplayName(provider)} OAuth client credentials are not configured.`);
  }
  if (!getOAuthStateSecret()) {
    throw new Error('OAUTH_STATE_SECRET (or ENCRYPTION_KEY) is required.');
  }
  return oauth;
}

function resolveAppOrigin(origin?: string): string {
  const raw = origin || process.env.NEXT_PUBLIC_APP_URL || 'https://wolfgrid.app';
  try {
    const parsed = new URL(raw);
    if (parsed.hostname.toLowerCase() === 'wolfgrid.app') parsed.hostname = 'wolfgrid.app';
    return parsed.origin;
  } catch {
    return 'https://wolfgrid.app';
  }
}

function signOAuthState(encodedPayload: string): string {
  return base64UrlEncode(createHmac('sha256', getOAuthStateSecret()).update(encodedPayload).digest());
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  return Buffer.from(pad === 0 ? normalized : normalized + '='.repeat(4 - pad), 'base64');
}
