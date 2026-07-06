import { spawn } from 'node:child_process';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import {
  markCampaignGeometryBuildFailed,
  markCampaignGeometryBuildPending,
} from '@/lib/diamond/geometryStage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DiamondBuildRequest = {
  campaignId?: unknown;
  campaign_id?: unknown;
  dryRun?: unknown;
  geometryStagePrefix?: unknown;
  reason?: unknown;
  source?: unknown;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function bearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  return authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : null;
}

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.DIAMOND_BUILD_WEBHOOK_SECRET?.trim();

  if (secret) {
    return (
      bearerToken(request) === secret ||
      request.headers.get('x-diamond-build-secret') === secret
    );
  }

  return process.env.NODE_ENV !== 'production';
}

function commandDescription(command: string | null): string {
  return command ? 'DIAMOND_BUILD_COMMAND' : 'npm run diamond:build';
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as DiamondBuildRequest | null;
  const campaignId =
    typeof body?.campaignId === 'string'
      ? body.campaignId
      : typeof body?.campaign_id === 'string'
        ? body.campaign_id
        : null;

  if (!campaignId || !UUID_PATTERN.test(campaignId)) {
    return NextResponse.json({ error: 'Valid campaignId is required' }, { status: 400 });
  }

  const customCommand = process.env.DIAMOND_BUILD_COMMAND?.trim() || null;
  const stagePrefix =
    typeof body?.geometryStagePrefix === 'string' && body.geometryStagePrefix.trim()
      ? body.geometryStagePrefix.trim()
      : process.env.GEOMETRY_STAGE_PREFIX?.trim() || null;
  const args = [
    campaignId,
    ...(body?.dryRun === true ? ['--dry-run'] : []),
    ...(stagePrefix ? [`--stage-prefix=${stagePrefix}`] : []),
  ];
  const buildReason = typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'manual';
  const buildSource = typeof body?.source === 'string' && body.source.trim() ? body.source.trim() : 'internal_diamond_build';

  try {
    await markCampaignGeometryBuildPending(createAdminClient(), campaignId, {
      reason: buildReason,
      source: buildSource,
    });
  } catch (metadataError) {
    console.warn('[DiamondBuild] Failed to mark geometry build pending:', {
      campaignId,
      error: metadataError instanceof Error ? metadataError.message : String(metadataError),
    });
  }

  const child = customCommand
    ? spawn(`${customCommand} ${args.join(' ')}`, {
        cwd: process.cwd(),
        detached: true,
        env: { ...process.env, ...(stagePrefix ? { GEOMETRY_STAGE_PREFIX: stagePrefix } : {}) },
        shell: true,
        stdio: 'ignore',
      })
    : spawn('npm', ['run', 'diamond:build', '--', ...args], {
        cwd: process.cwd(),
        detached: true,
        env: { ...process.env, ...(stagePrefix ? { GEOMETRY_STAGE_PREFIX: stagePrefix } : {}) },
        stdio: 'ignore',
      });

  child.once('error', async (error) => {
    try {
      await markCampaignGeometryBuildFailed(createAdminClient(), campaignId, {
        reason: buildReason,
        source: buildSource,
        error: error.message,
      });
    } catch (metadataError) {
      console.warn('[DiamondBuild] Failed to mark geometry build failed:', {
        campaignId,
        error: metadataError instanceof Error ? metadataError.message : String(metadataError),
      });
    }
  });

  child.unref();

  console.log('[DiamondBuild] Queued background build:', {
    campaignId,
    pid: child.pid,
    command: commandDescription(customCommand),
    dryRun: body?.dryRun === true,
    stagePrefix,
  });

  return NextResponse.json(
    {
      success: true,
      queued: true,
      campaign_id: campaignId,
      pid: child.pid ?? null,
      command: commandDescription(customCommand),
      geometry_stage_prefix: stagePrefix,
    },
    { status: 202 }
  );
}
