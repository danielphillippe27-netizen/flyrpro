import { SaleRecordPanel } from "@/components/field-sales/SaleRecordPanel";

export default async function SaleRecordPage({ params }: { params: Promise<{ saleId: string }> }) {
  const { saleId } = await params;
  return <SaleRecordPanel saleId={saleId} />;
}
