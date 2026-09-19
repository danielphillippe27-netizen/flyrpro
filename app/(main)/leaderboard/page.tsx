"use client";

import { Suspense, useState } from "react";
import { SalesDashboard } from "@/components/field-sales/SalesDashboard";
import { useFieldSales } from "@/lib/field-sales/client";
import { LeaderboardContentView } from "@/components/stats/LeaderboardContentView";

export default function LeaderboardPage() {
  const [sales, setSales] = useState(false);
  const { data } = useFieldSales({}, true);
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-background">
      <main className="mx-auto w-full max-w-7xl px-3 py-6 sm:px-6 lg:px-8">
        <div className="flex gap-4 mb-4">
          <button onClick={() => setSales(false)}>Activity</button>
          {data?.enabled && (
            <button onClick={() => setSales(true)}>Sales & Revenue · Beta</button>
          )}
        </div>
        {sales && data?.enabled ? (
          <Suspense>
            <SalesDashboard leaderboardOnly />
          </Suspense>
        ) : (
          <LeaderboardContentView />
        )}
      </main>
    </div>
  );
}
