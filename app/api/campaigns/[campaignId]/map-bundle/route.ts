import { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { resolveUserFromRequest } from '@/app/api/_utils/request-user';
import { ensureCampaignAccess } from '@/app/api/campaigns/_utils/access';
import {
  pendingCampaignMapBundleResponse,
  prebuildCampaignMapBundle,
  readCurrentCampaignMapBundle,
  readCurrentCampaignMapBundleMetadata,
  responseFromCampaignMapBundleRow,
} from '@/lib/services/CampaignMapBundlePrebuilder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ServerTimingSpan = { name: string; durationMs: number };

const REQUIRED_TIMING_PHASES = [
  'auth',
  'campaign',
  'snapshot',
  'addresses',
  'buildings',
  'parcels',
  'links',
  'signature',
  'bundle',
  'serialize',
  'total',
];

function elapsedMs(started: number) {
  return Math.round((performance.now() - started) * 100) / 100;
}

function normalizeTimingName(name: string) {
  return name.replace(/[^A-Za-z0-9_-]/g, '_');
}

function serverTimingValue(spans: ServerTimingSpan[]) {
  return spans
    .map((span) => `${normalizeTimingName(span.name)};dur=${Math.max(0, span.durationMs).toFixed(1)}`)
    .join(', ');
}

function stripWeakEtag(value: string) {
  return value.trim().replace(/^W\//i, '').replace(/^"|"$/g, '');
}

function clientSignature(request: NextRequest) {
  const querySignature = request.nextUrl.searchParams.get('signature')?.trim();
  if (querySignature) return stripWeakEtag(querySignature);

  const ifNoneMatch = request.headers.get('if-none-match');
  if (!ifNoneMatch) return null;
  return ifNoneMatch
    .split(',')
    .map(stripWeakEtag)
    .find(Boolean) ?? null;
}

function etagForSignature(signature: string) {
  return `"${signature.replace(/"/g, '')}"`;
}

function noStoreHeaders(spans: ServerTimingSpan[], extra?: Record<string, string>) {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    ...extra,
  });
  const timing = serverTimingValue(spans);
  if (timing) {
    headers.set('Server-Timing', timing);
    headers.set('X-FLYR-Server-Timing', timing);
  }
  return headers;
}

function finalizeTimings(spans: ServerTimingSpan[], startedAt: number) {
  if (!spans.some((span) => span.name === 'total')) {
    spans.push({ name: 'total', durationMs: elapsedMs(startedAt) });
  }
  for (const phase of REQUIRED_TIMING_PHASES) {
    if (!spans.some((span) => span.name === phase)) {
      spans.push({ name: phase, durationMs: 0 });
    }
  }
  spans.sort((a, b) => REQUIRED_TIMING_PHASES.indexOf(a.name) - REQUIRED_TIMING_PHASES.indexOf(b.name));
}

async function measured<T>(
  name: string,
  spans: ServerTimingSpan[],
  operation: () => Promise<T>
): Promise<T> {
  const started = performance.now();
  try {
    return await operation();
  } finally {
    spans.push({ name, durationMs: elapsedMs(started) });
  }
}

function jsonResponse(
  body: unknown,
  init: {
    status: number;
    spans: ServerTimingSpan[];
    startedAt: number;
    extraHeaders?: Record<string, string>;
  }
) {
  let serialized = '';
  const serializeStarted = performance.now();
  try {
    serialized = JSON.stringify(body);
  } finally {
    init.spans.push({ name: 'serialize', durationMs: elapsedMs(serializeStarted) });
  }
  finalizeTimings(init.spans, init.startedAt);
  return new Response(serialized, {
    status: init.status,
    headers: noStoreHeaders(init.spans, {
      'Content-Type': 'application/json',
      ...init.extraHeaders,
    }),
  });
}

function emptyResponse(init: {
  status: number;
  spans: ServerTimingSpan[];
  startedAt: number;
  extraHeaders?: Record<string, string>;
}) {
  finalizeTimings(init.spans, init.startedAt);
  return new Response(null, {
    status: init.status,
    headers: noStoreHeaders(init.spans, init.extraHeaders),
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ campaignId: string }> }
) {
  const startedAt = performance.now();
  const spans: ServerTimingSpan[] = [];
  const { campaignId } = await params;

  try {
    const requestUser = await measured('auth', spans, () => resolveUserFromRequest(request));
    if (!requestUser) {
      return jsonResponse(
        { error: 'Unauthorized' },
        { status: 401, spans, startedAt }
      );
    }

    const supabase = createAdminClient();
    const allowed = await measured('campaign', spans, () =>
      ensureCampaignAccess(supabase, campaignId, requestUser.id)
    );
    if (!allowed) {
      return jsonResponse(
        { error: 'Campaign not found or access denied' },
        { status: 404, spans, startedAt }
      );
    }

    const signature = clientSignature(request);
    if (signature) {
      const metadata = await measured('signature', spans, () =>
        readCurrentCampaignMapBundleMetadata(supabase, campaignId)
      );
      if (metadata?.asset_signature === signature) {
        return emptyResponse({
          status: 304,
          spans,
          startedAt,
          extraHeaders: {
            ETag: etagForSignature(metadata.asset_signature),
            'X-FLYR-Map-Bundle-Cache': 'not-modified',
          },
        });
      }
    }

    const current = await measured(signature ? 'bundle' : 'signature', spans, () =>
      readCurrentCampaignMapBundle(supabase, campaignId)
    );
    if (current && signature && current.asset_signature === signature) {
      return emptyResponse({
        status: 304,
        spans,
        startedAt,
        extraHeaders: {
          ETag: etagForSignature(current.asset_signature),
          'X-FLYR-Map-Bundle-Cache': 'not-modified',
        },
      });
    }

    if (current) {
      const bundle = responseFromCampaignMapBundleRow(current, (name, durationMs) => {
        spans.push({ name, durationMs });
      });
      return jsonResponse(bundle, {
        status: 200,
        spans,
        startedAt,
        extraHeaders: {
          ETag: etagForSignature(current.asset_signature),
          'X-FLYR-Map-Bundle-Cache': 'hit',
        },
      });
    }

    const hasSnapshot = await measured('snapshot', spans, async () => {
      const { data } = await supabase
        .from('campaign_snapshots')
        .select('campaign_id')
        .eq('campaign_id', campaignId)
        .maybeSingle();
      return Boolean(data?.campaign_id);
    });

    if (hasSnapshot) {
      try {
        const rebuilt = await measured('build', spans, () =>
          prebuildCampaignMapBundle(supabase, campaignId, (name, durationMs) => {
            spans.push({ name, durationMs });
          })
        );
        return jsonResponse(rebuilt, {
          status: 200,
          spans,
          startedAt,
          extraHeaders: {
            ETag: etagForSignature(rebuilt.asset_signature),
            'X-FLYR-Map-Bundle-Cache': 'rebuilt',
          },
        });
      } catch (buildError) {
        console.warn('[map-bundle] On-demand prebuild failed; returning pending bundle:', {
          campaignId,
          message: buildError instanceof Error ? buildError.message : String(buildError),
        });
      }
    }

    return jsonResponse(pendingCampaignMapBundleResponse(campaignId), {
      status: 200,
      spans,
      startedAt,
      extraHeaders: {
        'X-FLYR-Map-Bundle-Cache': 'pending',
      },
    });
  } catch (error) {
    console.error('[map-bundle] GET failed:', error);
    return jsonResponse(
      { error: 'Failed to load campaign map bundle' },
      { status: 500, spans, startedAt }
    );
  }
}
