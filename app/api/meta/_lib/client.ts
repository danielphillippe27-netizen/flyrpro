import { getMetaApiVersion } from './oauth';

const META_GRAPH_HOST = 'https://graph.facebook.com';

export type MetaAdAccountPayload = {
  id?: string;
  account_id?: string;
  name?: string;
  currency?: string;
  account_status?: string | number;
};

export type MetaCampaignPayload = {
  id: string;
  name?: string;
  status?: string;
  objective?: string;
  start_time?: string;
  stop_time?: string;
};

export type MetaAdPayload = {
  id: string;
  name?: string;
  status?: string;
  effective_status?: string;
  creative?: {
    id?: string;
    name?: string;
    thumbnail_url?: string;
  };
};

export type MetaInsightPayload = {
  date_start?: string;
  date_stop?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  actions?: Array<{ action_type?: string; value?: string }>;
};

type MetaListResponse<T> = {
  data?: T[];
  paging?: {
    next?: string;
  };
};

export class MetaApiError extends Error {
  status: number;
  code?: number;
  type?: string;
  isRateLimit: boolean;
  isAuthError: boolean;

  constructor(message: string, options: { status: number; code?: number; type?: string }) {
    super(message);
    this.name = 'MetaApiError';
    this.status = options.status;
    this.code = options.code;
    this.type = options.type;
    this.isRateLimit = options.status === 429 || [4, 17, 32, 613].includes(options.code ?? -1);
    this.isAuthError = options.status === 401 || [190, 200, 10].includes(options.code ?? -1);
  }
}

function graphUrl(path: string, params: URLSearchParams): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${META_GRAPH_HOST}/${getMetaApiVersion()}${normalizedPath}?${params.toString()}`;
}

async function readMetaJson<T>(res: Response): Promise<T> {
  const raw = await res.text();
  let data: unknown = null;
  if (raw) {
    try {
      data = JSON.parse(raw);
    } catch {
      throw new MetaApiError('Meta returned invalid JSON.', { status: res.status });
    }
  }

  if (!res.ok) {
    const error = (data as { error?: { message?: string; code?: number; type?: string } } | null)?.error;
    throw new MetaApiError(error?.message || raw || `Meta API request failed (${res.status})`, {
      status: res.status,
      code: error?.code,
      type: error?.type,
    });
  }

  return data as T;
}

async function metaGet<T>(path: string, accessToken: string, params: Record<string, string>): Promise<T> {
  const searchParams = new URLSearchParams(params);
  searchParams.set('access_token', accessToken);
  const res = await fetch(graphUrl(path, searchParams), { cache: 'no-store' });
  return readMetaJson<T>(res);
}

async function fetchAllPages<T>(path: string, accessToken: string, params: Record<string, string>): Promise<T[]> {
  let response = await metaGet<MetaListResponse<T>>(path, accessToken, params);
  const rows: T[] = Array.isArray(response.data) ? [...response.data] : [];

  while (response.paging?.next) {
    const res = await fetch(response.paging.next, { cache: 'no-store' });
    response = await readMetaJson<MetaListResponse<T>>(res);
    if (Array.isArray(response.data)) rows.push(...response.data);
  }

  return rows;
}

export function normalizeMetaAdAccountId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed.startsWith('act_') ? trimmed : `act_${trimmed}`;
}

export async function listMetaAdAccounts(accessToken: string): Promise<MetaAdAccountPayload[]> {
  return fetchAllPages<MetaAdAccountPayload>('/me/adaccounts', accessToken, {
    fields: 'id,account_id,name,currency,account_status',
    limit: '100',
  });
}

export async function listMetaCampaigns(
  accessToken: string,
  adAccountId: string
): Promise<MetaCampaignPayload[]> {
  return fetchAllPages<MetaCampaignPayload>(`/${normalizeMetaAdAccountId(adAccountId)}/campaigns`, accessToken, {
    fields: 'id,name,status,objective,start_time,stop_time',
    limit: '100',
  });
}

export async function listMetaAds(
  accessToken: string,
  campaignId: string
): Promise<MetaAdPayload[]> {
  return fetchAllPages<MetaAdPayload>(`/${campaignId}/ads`, accessToken, {
    fields: 'id,name,status,effective_status,creative{id,name,thumbnail_url}',
    limit: '50',
  });
}

export async function listCampaignDailyInsights(
  accessToken: string,
  campaignId: string,
  options?: {
    since?: string;
    until?: string;
  }
): Promise<MetaInsightPayload[]> {
  const params: Record<string, string> = {
    fields: 'spend,impressions,reach,clicks,actions',
    time_increment: '1',
    limit: '500',
  };

  if (options?.since && options.until) {
    params.time_range = JSON.stringify({ since: options.since, until: options.until });
  } else {
    params.date_preset = 'maximum';
  }

  return fetchAllPages<MetaInsightPayload>(`/${campaignId}/insights`, accessToken, {
    ...params,
  });
}

export async function listAdInsights(
  accessToken: string,
  adId: string,
  options?: {
    since?: string;
    until?: string;
  }
): Promise<MetaInsightPayload[]> {
  const params: Record<string, string> = {
    fields: 'spend,impressions,reach,clicks,actions',
    limit: '100',
  };

  if (options?.since && options.until) {
    params.time_range = JSON.stringify({ since: options.since, until: options.until });
  } else {
    params.date_preset = 'last_7d';
  }

  return fetchAllPages<MetaInsightPayload>(`/${adId}/insights`, accessToken, {
    ...params,
  });
}

export function metaErrorResponse(error: unknown): { message: string; status: number; code: string } {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/expired|revoked|reconnect meta ads/i.test(message)) {
    return {
      message: message || 'Meta permissions expired or were revoked. Reconnect Meta Ads.',
      status: 401,
      code: 'token_expired',
    };
  }
  if (/connect meta ads first/i.test(message)) {
    return {
      message,
      status: 401,
      code: 'not_connected',
    };
  }

  if (error instanceof MetaApiError) {
    if (error.isRateLimit) {
      return {
        message: 'Meta rate limit reached. Please wait a few minutes and try again.',
        status: 429,
        code: 'rate_limited',
      };
    }
    if (error.isAuthError) {
      return {
        message: 'Meta permissions expired or were revoked. Reconnect Meta Ads.',
        status: 401,
        code: 'token_expired',
      };
    }
    return {
      message: error.message,
      status: error.status >= 400 ? error.status : 502,
      code: 'meta_api_error',
    };
  }

  return {
    message: message || 'Meta request failed.',
    status: 500,
    code: 'meta_request_failed',
  };
}
