import { Suspense } from "react";
import { SalesDashboard } from "@/components/field-sales/SalesDashboard";
export default function SalesPage() {
  return (
    <Suspense fallback={<p>Loading Sales…</p>}>
      <SalesDashboard />
    </Suspense>
  );
}
