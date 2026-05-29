import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { NextRequest, NextResponse } from 'next/server';
import {
  latestCampaignPolygonParityReportPath,
  readCampaignPolygonParityReport,
} from '@/lib/campaign-polygon-parity/report-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Surface = 'flyr_pro' | 'ios_wire' | 'android_wire';
type JobStatus = 'idle' | 'running' | 'passed' | 'failed';

type SurfaceProgress = {
  status: 'idle' | 'running' | 'passed' | 'failed';
  campaignId: string | null;
  runLabel: string | null;
  lastMessage: string | null;
};

type DashboardJob = {
  id: string;
  status: JobStatus;
  startedAt: string | null;
  finishedAt: string | null;
  command: string[];
  exitCode: number | null;
  reportDir: string | null;
  reportPath: string | null;
  logs: string[];
  surfaces: Record<Surface, SurfaceProgress>;
  process: ChildProcessWithoutNullStreams | null;
};

type StartBody = {
  runs?: number;
  captureScreenshot?: boolean;
  strictBaseline?: boolean;
  strictPerformance?: boolean;
};

const MAX_LOG_LINES = 600;

const globalStore = globalThis as typeof globalThis & {
  __campaignPolygonParityJob?: DashboardJob;
};

function emptySurfaces(): Record<Surface, SurfaceProgress> {
  return {
    flyr_pro: emptySurface(),
    ios_wire: emptySurface(),
    android_wire: emptySurface(),
  };
}

function emptySurface(): SurfaceProgress {
  return {
    status: 'idle',
    campaignId: null,
    runLabel: null,
    lastMessage: null,
  };
}

function currentJob(): DashboardJob {
  if (!globalStore.__campaignPolygonParityJob) {
    globalStore.__campaignPolygonParityJob = {
      id: 'idle',
      status: 'idle',
      startedAt: null,
      finishedAt: null,
      command: [],
      exitCode: null,
      reportDir: null,
      reportPath: null,
      logs: [],
      surfaces: emptySurfaces(),
      process: null,
    };
  }
  return globalStore.__campaignPolygonParityJob;
}

function isDashboardEnabled() {
  return process.env.NODE_ENV === 'development' || process.env.ALLOW_CAMPAIGN_PARITY_DASHBOARD === '1';
}

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      'Cache-Control': 'no-store',
      ...(init?.headers ?? {}),
    },
  });
}

function appendLog(job: DashboardJob, text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  for (const line of lines) {
    job.logs.push(line);
    parseProgressLine(job, line);
  }

  if (job.logs.length > MAX_LOG_LINES) {
    job.logs.splice(0, job.logs.length - MAX_LOG_LINES);
  }
}

function parseProgressLine(job: DashboardJob, line: string) {
  const reportDir = line.match(/^Report directory:\s+(.+)$/);
  if (reportDir) {
    job.reportDir = reportDir[1];
    return;
  }

  const reportPath = line.match(/^JSON report:\s+(.+)$/);
  if (reportPath) {
    job.reportPath = reportPath[1];
    return;
  }

  const progress = line.match(/^\[(flyr_pro|ios_wire|android_wire)\s+([^\]]+)\]\s+(starting|passed|failed)(?:\s+campaign=(.+))?$/);
  if (!progress) return;

  const surface = progress[1] as Surface;
  const statusText = progress[3] as 'starting' | 'passed' | 'failed';
  const campaignId = progress[4]?.trim();
  job.surfaces[surface] = {
    status: statusText === 'starting' ? 'running' : statusText,
    campaignId: campaignId && campaignId !== 'none' ? campaignId : job.surfaces[surface].campaignId,
    runLabel: progress[2],
    lastMessage: line,
  };
}

async function responsePayload() {
  const job = currentJob();
  const reportPath = job.reportPath ?? (await latestCampaignPolygonParityReportPath());
  const report = await readCampaignPolygonParityReport(reportPath);
  return {
    job: {
      id: job.id,
      status: job.status,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      command: job.command,
      exitCode: job.exitCode,
      reportDir: job.reportDir,
      reportPath,
      logs: job.logs,
      surfaces: job.surfaces,
    },
    latestReport: report,
  };
}

export async function GET() {
  if (!isDashboardEnabled()) {
    return json({ error: 'Not found' }, { status: 404 });
  }

  return json(await responsePayload());
}

export async function POST(request: NextRequest) {
  if (!isDashboardEnabled()) {
    return json({ error: 'Not found' }, { status: 404 });
  }

  const active = currentJob();
  if (active.status === 'running') {
    return json(await responsePayload(), { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as StartBody;
  const runs = Number.isFinite(Number(body.runs)) && Number(body.runs) > 0 ? Math.floor(Number(body.runs)) : 1;
  const id = `dashboard-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const command = ['npm', 'run', 'test:campaign-polygon-parity'];

  const job: DashboardJob = {
    id,
    status: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    command,
    exitCode: null,
    reportDir: null,
    reportPath: null,
    logs: [],
    surfaces: emptySurfaces(),
    process: null,
  };

  globalStore.__campaignPolygonParityJob = job;

  const child = spawn(command[0], command.slice(1), {
    cwd: process.cwd(),
    env: {
      ...process.env,
      E2E_RUNS: String(runs),
      E2E_CAPTURE_SCREENSHOT: body.captureScreenshot ? '1' : '0',
      E2E_STRICT_BASELINE: body.strictBaseline ? '1' : '0',
      E2E_STRICT_PERFORMANCE: body.strictPerformance ? '1' : '0',
    },
  });
  job.process = child;

  appendLog(job, `$ ${command.join(' ')} (E2E_RUNS=${runs})`);

  child.stdout.on('data', (chunk) => appendLog(job, chunk.toString()));
  child.stderr.on('data', (chunk) => appendLog(job, chunk.toString()));
  child.on('error', (error) => {
    appendLog(job, `Process error: ${error.message}`);
    job.status = 'failed';
    job.finishedAt = new Date().toISOString();
    job.process = null;
  });
  child.on('close', (code) => {
    job.exitCode = code;
    job.status = code === 0 ? 'passed' : 'failed';
    job.finishedAt = new Date().toISOString();
    job.process = null;
  });

  return json(await responsePayload(), { status: 202 });
}
