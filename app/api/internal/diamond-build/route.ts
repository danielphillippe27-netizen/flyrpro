import { spawn } from 'node:child_process';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DiamondBuildRequest = {
  campaignId?: unknown;
  campaign_id?: unknown;
  dryRun?: unknown;
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
  const args = body?.dryRun === true ? [campaignId, '--dry-run'] : [campaignId];
  const child = customCommand
    ? spawn(`${customCommand} ${args.join(' ')}`, {
        cwd: process.cwd(),
        detached: true,
        env: process.env,
        shell: true,
        stdio: 'ignore',
      })
    : spawn('npm', ['run', 'diamond:build', '--', ...args], {
        cwd: process.cwd(),
        detached: true,
        env: process.env,
        stdio: 'ignore',
      });

  child.unref();

  console.log('[DiamondBuild] Queued background build:', {
    campaignId,
    pid: child.pid,
    command: commandDescription(customCommand),
    dryRun: body?.dryRun === true,
  });

  return NextResponse.json(
    {
      success: true,
      queued: true,
      campaign_id: campaignId,
      pid: child.pid ?? null,
      command: commandDescription(customCommand),
    },
    { status: 202 }
  );
}
