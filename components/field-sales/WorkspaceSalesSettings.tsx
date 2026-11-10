"use client";

import { useState } from "react";
import Link from "next/link";
import { Switch } from "@/components/ui/switch";
import { salesChanged, useFieldSales } from "@/lib/field-sales/client";
import { createClient } from "@/lib/supabase/client";

type SalesSetting = { enabled: boolean; can_manage: boolean; needs_setup: boolean };

export function WorkspaceSalesSettings() {
  const { data, error, refresh, workspaceId } = useFieldSales<SalesSetting>({}, false, "field_sales_workspace_command");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  if (!workspaceId || !data?.can_manage) {
    return error ? <button onClick={refresh}>Retry loading Sales settings</button> : null;
  }

  async function setEnabled(enabled: boolean) {
    setSaving(true);
    setSaveError(null);
    try {
      const { error } = await createClient().rpc("field_sales_workspace_command", {
        p_workspace: workspaceId,
        p_enabled: enabled,
      });
      if (error) throw new Error(error.message);
      window.dispatchEvent(new Event(salesChanged));
    } catch (failure) {
      setSaveError(failure instanceof Error ? failure.message : "Couldn't update Sales.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3 rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold">Sales</h2>
          <p id="workspace-sales-description" className="text-sm text-muted-foreground">
            Show Sales across this workspace. On by default for roofing.
          </p>
        </div>
        <Switch checked={data.enabled} disabled={saving} onCheckedChange={setEnabled}
          aria-label="Workspace Sales" aria-describedby="workspace-sales-description" />
      </div>
      {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
      {data.needs_setup && <Link className="text-sm underline" href="/sales">Set reporting currency and timezone</Link>}
    </section>
  );
}
