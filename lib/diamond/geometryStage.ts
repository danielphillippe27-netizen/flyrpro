import { triggerDiamondBuild, type DiamondBuildTriggerResult } from '@/lib/diamond/buildTrigger';

type SupabaseLike = any;

type CampaignSnapshotMetadataRow = {
  tile_metrics?: Record<string, unknown> | null;
  buildings_key?: string | null;
};

export type GeometryBuildStage = {
  stage: string;
  prefix: string | null;
};

type QueueGeometryRebuildOptions = {
  reason: string;
  source: string;
  addressCount?: number;
  buildingCount?: number;
  mapMode?: string;
};

function normalizeStagePrefix(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/^\/+|\/+$/g, '') ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

export function currentGeometryBuildStage(): GeometryBuildStage {
  const prefix = normalizeStagePrefix(process.env.GEOMETRY_STAGE_PREFIX);
  return {
    stage: process.env.GEOMETRY_STAGE?.trim() || prefix || 'production',
    prefix,
  };
}

export function withGeometryStagePrefix(path: string, stage: GeometryBuildStage = currentGeometryBuildStage()) {
  const normalizedPath = path.replace(/^\/+/, '');
  if (!stage.prefix) return normalizedPath;
  return normalizedPath.startsWith(`${stage.prefix}/`)
    ? normalizedPath
    : `${stage.prefix}/${normalizedPath}`;
}

function hasReadyGeometry(row: CampaignSnapshotMetadataRow | null) {
  const metrics = row?.tile_metrics ?? {};
  return Boolean(
    metrics.pmtiles_key ||
    metrics.addresses_pmtiles_key ||
    row?.buildings_key?.endsWith('.pmtiles')
  );
}

export function pendingGeometryTileMetrics(
  row: CampaignSnapshotMetadataRow | null,
  options: QueueGeometryRebuildOptions,
  stage: GeometryBuildStage = currentGeometryBuildStage()
): Record<string, unknown> {
  return {
    ...(row?.tile_metrics ?? {}),
    geometry_build_status: 'pending',
    geometry_stage: stage.stage,
    geometry_stage_prefix: stage.prefix,
    stale_geometry: hasReadyGeometry(row),
    geometry_build_reason: options.reason,
    geometry_build_source: options.source,
    geometry_build_requested_at: new Date().toISOString(),
  };
}

export function failedGeometryTileMetrics(
  row: CampaignSnapshotMetadataRow | null,
  options: QueueGeometryRebuildOptions & { error: string },
  stage: GeometryBuildStage = currentGeometryBuildStage()
): Record<string, unknown> {
  return {
    ...(row?.tile_metrics ?? {}),
    geometry_build_status: 'failed',
    geometry_stage: stage.stage,
    geometry_stage_prefix: stage.prefix,
    stale_geometry: hasReadyGeometry(row),
    geometry_build_reason: options.reason,
    geometry_build_source: options.source,
    geometry_build_error: options.error,
    geometry_build_failed_at: new Date().toISOString(),
  };
}

async function readSnapshot(admin: SupabaseLike, campaignId: string): Promise<CampaignSnapshotMetadataRow | null> {
  const { data, error } = await admin
    .from('campaign_snapshots')
    .select('tile_metrics, buildings_key')
    .eq('campaign_id', campaignId)
    .maybeSingle();

  if (error) throw new Error(error.message || 'Failed to load campaign snapshot');
  return (data as CampaignSnapshotMetadataRow | null) ?? null;
}

async function updateSnapshotMetrics(
  admin: SupabaseLike,
  campaignId: string,
  tileMetrics: Record<string, unknown>
) {
  const { error } = await admin
    .from('campaign_snapshots')
    .update({ tile_metrics: tileMetrics })
    .eq('campaign_id', campaignId);

  if (error) throw new Error(error.message || 'Failed to update campaign snapshot');
}

export async function markCampaignGeometryBuildPending(
  admin: SupabaseLike,
  campaignId: string,
  options: QueueGeometryRebuildOptions
) {
  const row = await readSnapshot(admin, campaignId);
  if (!row) return { status: 'skipped' as const, reason: 'campaign_snapshot_missing' };

  const tileMetrics = pendingGeometryTileMetrics(row, options);
  await updateSnapshotMetrics(admin, campaignId, tileMetrics);
  return { status: 'updated' as const, staleGeometry: tileMetrics.stale_geometry === true };
}

export async function markCampaignGeometryBuildFailed(
  admin: SupabaseLike,
  campaignId: string,
  options: QueueGeometryRebuildOptions & { error: string }
) {
  const row = await readSnapshot(admin, campaignId);
  if (!row) return { status: 'skipped' as const, reason: 'campaign_snapshot_missing' };

  await updateSnapshotMetrics(admin, campaignId, failedGeometryTileMetrics(row, options));
  return { status: 'updated' as const };
}

export async function queueCampaignGeometryRebuild(
  admin: SupabaseLike,
  campaignId: string,
  options: QueueGeometryRebuildOptions
): Promise<{
  snapshotStatus: 'updated' | 'skipped';
  trigger: DiamondBuildTriggerResult;
}> {
  const pending = await markCampaignGeometryBuildPending(admin, campaignId, options);
  const trigger = await triggerDiamondBuild({
    campaignId,
    reason: options.reason,
    source: options.source,
    addressCount: options.addressCount,
    buildingCount: options.buildingCount,
    mapMode: options.mapMode,
    geometryStagePrefix: currentGeometryBuildStage().prefix,
  });

  if (trigger.status === 'failed') {
    await markCampaignGeometryBuildFailed(admin, campaignId, {
      ...options,
      error: trigger.error,
    });
  } else if (trigger.status === 'skipped') {
    await markCampaignGeometryBuildFailed(admin, campaignId, {
      ...options,
      error: trigger.reason,
    });
  }

  return {
    snapshotStatus: pending.status === 'updated' ? 'updated' : 'skipped',
    trigger,
  };
}
