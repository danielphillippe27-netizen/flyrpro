import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

function workspaceRoot() {
  const cwd = process.cwd();
  return path.basename(cwd) === 'FLYR-PRO' ? path.dirname(cwd) : cwd;
}

export const CAMPAIGN_POLYGON_PARITY_REPORT_ROOT = path.join(
  workspaceRoot(),
  '.tmp',
  'campaign-polygon-parity'
);

export async function readCampaignPolygonParityReport(reportPath: string | null) {
  if (!reportPath || !existsSync(reportPath)) return null;
  try {
    return dashboardReport(JSON.parse(readFileSync(reportPath, 'utf8')));
  } catch {
    return null;
  }
}

export async function latestCampaignPolygonParityReportPath() {
  try {
    const entries = readdirSync(CAMPAIGN_POLYGON_PARITY_REPORT_ROOT, { withFileTypes: true });
    const candidates = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const reportPath = path.join(CAMPAIGN_POLYGON_PARITY_REPORT_ROOT, entry.name, 'report.json');
        try {
          const reportStat = statSync(reportPath);
          return { reportPath, mtimeMs: reportStat.mtimeMs };
        } catch {
          return null;
        }
      });
    return candidates
      .filter((candidate): candidate is { reportPath: string; mtimeMs: number } => Boolean(candidate))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.reportPath ?? null;
  } catch {
    return null;
  }
}

function dashboardReport(report: any) {
  return {
    runId: report?.runId,
    createdAt: report?.createdAt,
    fixture: report?.fixture,
    validationErrors: Array.isArray(report?.validationErrors) ? report.validationErrors : [],
    stats: report?.stats ?? {},
    results: Array.isArray(report?.results)
      ? report.results.map((result: any) => ({
          surface: result?.surface,
          ordinal: result?.ordinal,
          campaignId: result?.campaignId,
          timings: result?.timings ?? {},
          counts: result?.counts,
          warnings: Array.isArray(result?.warnings) ? result.warnings : [],
          errors: Array.isArray(result?.errors) ? result.errors : [],
        }))
      : [],
  };
}
