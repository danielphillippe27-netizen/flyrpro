import { SalesPipelineDetailView } from '@/components/sales-pipeline/SalesPipelineDetailView';

export default async function SalesPipelineLeadPage({
  params,
}: {
  params: Promise<{ leadId: string }>;
}) {
  const { leadId } = await params;
  return <SalesPipelineDetailView leadId={leadId} />;
}
