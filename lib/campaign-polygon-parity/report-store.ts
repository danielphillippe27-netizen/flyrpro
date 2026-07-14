import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

function workspaceRoot() {
  const cwd = process.cwd();
  return path.basename(cwd) === 'WolfGrid Web' ? path.dirname(cwd) : cwd;
}

export const CAMPAIGN_POLYGON_PARITY_REPORT_ROOT = path.join(
  workspaceRoot(),
  '.tmp',
  'campaign-polygon-parity'
);

export async function readCampaignPolygonParityReport(reportPath: string | null) {
  if (!reportPath || !existsSync(reportPath)) return null;
  try {
    return dashboardReport(JSON.parse(readFileSync(reportPath, 'utf8')) as unknown);
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function dashboardReport(report: unknown) {
  const reportRecord = asRecord(report);
  const results = Array.isArray(reportRecord?.results) ? reportRecord.results : [];

  return {
    runId: reportRecord?.runId,
    createdAt: reportRecord?.createdAt,
    fixture: reportRecord?.fixture,
    validationErrors: Array.isArray(reportRecord?.validationErrors) ? reportRecord.validationErrors : [],
    stats: reportRecord?.stats ?? {},
    results: results.map((result) => {
      const resultRecord = asRecord(result);
      const endpoints = asRecord(resultRecord?.endpoints);

      return {
        surface: resultRecord?.surface,
        ordinal: resultRecord?.ordinal,
        campaignId: resultRecord?.campaignId,
        timings: resultRecord?.timings ?? {},
        counts: resultRecord?.counts,
        workflow: resultRecord?.workflow,
        endpoints: endpoints
            ? {
                mapBundle: endpointSummary(endpoints.mapBundle),
                addresses: endpointSummary(endpoints.addresses),
                buildingsCold: endpointSummary(endpoints.buildingsCold),
                buildingsBypass: endpointSummary(endpoints.buildingsBypass),
                parcels: endpointSummary(endpoints.parcels),
              }
            : undefined,
        warnings: Array.isArray(resultRecord?.warnings) ? resultRecord.warnings : [],
        errors: Array.isArray(resultRecord?.errors) ? resultRecord.errors : [],
      };
    }),
  };
}

function endpointSummary(endpoint: unknown) {
  const endpointRecord = asRecord(endpoint);
  if (!endpointRecord) return undefined;

  return {
    status: endpointRecord.status,
    seconds: endpointRecord.seconds,
    count: endpointRecord.count,
    hash: endpointRecord.hash,
    bytes: endpointRecord.bytes,
    headers: endpointRecord.headers,
  };
}
