import {
  latestCampaignPolygonParityReportPath,
  readCampaignPolygonParityReport,
} from '@/lib/campaign-polygon-parity/report-store';
import {
  CampaignPolygonParityDashboard,
  type ApiPayload,
} from './CampaignPolygonParityDashboard';

export const dynamic = 'force-dynamic';

export default async function CampaignPolygonParityPage() {
  const reportPath = await latestCampaignPolygonParityReportPath();
  const latestReport = await readCampaignPolygonParityReport(reportPath);

  const initialPayload: ApiPayload = {
    job: {
      id: 'idle',
      status: 'idle',
      startedAt: null,
      finishedAt: null,
      command: [],
      exitCode: null,
      reportDir: reportPath ? reportPath.replace(/\/report\.json$/, '') : null,
      reportPath,
      logs: [],
      surfaces: {
        flyr_pro: emptySurface(),
        ios_wire: emptySurface(),
        android_wire: emptySurface(),
      },
    },
    latestReport: latestReport as ApiPayload['latestReport'],
  };

  return <CampaignPolygonParityDashboard initialPayload={initialPayload} />;
}

function emptySurface() {
  return {
    status: 'idle' as const,
    campaignId: null,
    runLabel: null,
    lastMessage: null,
  };
}
