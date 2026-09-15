"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useWorkspace } from "@/lib/workspace-context";

export type Sale = {
  id: string;
  rep_id: string;
  rep_name: string;
  status: string;
  sold_on: string;
  version: number;
  value_minor?: string;
  currency: string;
  contact_id?: string;
  appointment_id?: string;
  campaign_id?: string;
  territory_id?: string;
  notes?: string;
  cancellation_reason?: string;
  can_edit: boolean;
  can_verify: boolean;
  can_cancel: boolean;
};
export type SalesData = {
  enabled: boolean;
  needs_setup?: boolean;
  role: string;
  user_id: string;
  currency?: string;
  timezone?: string;
  team_revenue_visible: boolean;
  today: string;
  month: string;
  as_of: string;
  period: string;
  period_start?: string;
  period_end?: string;
  coaching: string;
  totals: {
    sales: number;
    revenue_minor?: string;
    weekly_sales: number;
    weekly_revenue_minor?: string;
    monthly_sales: number;
    monthly_revenue_minor?: string;
  };
  goal: { target: number | null; completed: number; remaining: number | null };
  metrics: {
    doors: number;
    conversations: number;
    leads: number;
    appointments: number;
    lead_converted: number;
    appointment_converted: number | null;
    unlinked_sales: number;
    sales_per_100_doors: number | null;
  };
  sales: Sale[];
  list_limit: number;
  ranking: {
    rep_id: string;
    rep_name: string;
    sales: number;
    revenue_minor?: string;
  }[];
  feed: {
    id: string;
    rep_name: string;
    sold_on: string;
    value_minor?: string;
  }[];
  options: {
    leads: { id: string; name: string; campaign_id?: string }[];
    appointments: { id: string; contact_id: string; scheduled_at: string }[];
    campaigns: { id: string; name: string }[];
  };
};
export type SalesFilter = {
  period?: string;
  team?: boolean;
  rep?: string;
  campaign?: string;
  status?: string;
};
export const salesChanged = "wolfgrid:field-sales-changed";
export function useFieldSales<T = SalesData>(
  filter: SalesFilter = {},
  bootstrap = false,
  resource?: "field_sales_workbench",
) {
  const { currentWorkspaceId } = useWorkspace();
  const [snapshot, setSnapshot] = useState<{
    workspace: string;
    data: T;
  } | null>(null);
  const setData = useCallback(
    (value: T | null) =>
      setSnapshot(
        value && currentWorkspaceId
          ? { workspace: currentWorkspaceId, data: value }
          : null,
      ),
    [currentWorkspaceId],
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const generation = useRef(0);
  const {
    period = "month",
    team = false,
    rep = "",
    campaign = "",
    status = "",
  } = filter;
  const refresh = useCallback(() => setRevision((x) => x + 1), []);
  useEffect(() => {
    let active = true;
    const client = createClient();
    setData(null);
    setError(null);
    setLoading(true);
    async function load() {
      const ticket = ++generation.current;
      if (!currentWorkspaceId) {
        setLoading(false);
        return;
      }
      try {
        const { data: session } = await client.auth.getSession();
        if (!session.session) {
          if (active && ticket === generation.current) {
            setData(null);
            setLoading(false);
          }
          return;
        }
        const { data: result, error: failure } = await client.rpc(
          resource ??
            (bootstrap ? "field_sales_bootstrap" : "field_sales_dashboard"),
          bootstrap || resource
            ? { p_workspace: currentWorkspaceId }
            : {
                p_workspace: currentWorkspaceId,
                p_period: period,
                p_team: team,
                p_rep: rep || null,
                p_campaign: campaign || null,
                p_status: status || null,
              },
        );
        if (!active || ticket !== generation.current) return;
        if (failure) throw failure;
        setData(result);
        setError(null);
      } catch (e) {
        if (active && ticket === generation.current) {
          setData(null);
          setError(
            e instanceof Error
              ? e.message
              : ((e as { message?: string }).message ?? "Unable to load Sales"),
          );
        }
      } finally {
        if (active && ticket === generation.current) setLoading(false);
      }
    }
    void load();
    const { data: listener } = client.auth.onAuthStateChange(() => {
      generation.current++;
      setData(null);
      queueMicrotask(() => {
        if (active) void load();
      });
    });
    const update = () => {
      if (active) void load();
    };
    window.addEventListener(salesChanged, update);
    window.addEventListener("focus", update);
    return () => {
      active = false;
      listener.subscription.unsubscribe();
      window.removeEventListener(salesChanged, update);
      window.removeEventListener("focus", update);
    };
  }, [
    currentWorkspaceId,
    period,
    team,
    rep,
    campaign,
    status,
    bootstrap,
    resource,
    revision,
    setData,
  ]);
  // Prevent even one render of the previous workspace's data.
  const scopedData =
    snapshot?.workspace === currentWorkspaceId ? snapshot.data : null;
  return {
    data: scopedData,
    error,
    loading,
    refresh,
    workspaceId: currentWorkspaceId,
  };
}
export async function salesCommand(
  workspace: string,
  action: string,
  data: Record<string, unknown>,
  resource:
    | "field_sales_command"
    | "field_sales_pipeline_command" = "field_sales_command",
) {
  const { data: result, error } = await createClient().rpc(resource, {
    p_workspace: workspace,
    p_action: action,
    p_data: data,
  });
  if (error) throw new Error(error.message);
  window.dispatchEvent(new Event(salesChanged));
  return result;
}
export function minorUnits(text: string, currency: string): string {
  const decimals = currency === "JPY" ? 0 : 2;
  const value = text.trim();
  if (!(decimals === 0 ? /^\d+$/ : /^\d+(?:\.\d{1,2})?$/).test(value))
    throw new Error(
      "Enter a valid contract value with the correct decimal places.",
    );
  if (decimals === 0 && value.includes("."))
    throw new Error("JPY uses whole units.");
  const [whole, fraction = ""] = value.split(".");
  const minor =
    BigInt(whole) * BigInt(10) ** BigInt(decimals) +
    BigInt(fraction.padEnd(decimals, "0") || "0");
  if (minor <= BigInt(0) || minor > BigInt(9000000000000000))
    throw new Error("Contract value is outside the supported range.");
  return minor.toString();
}
export function money(minor: string | undefined, currency = "CAD") {
  if (minor === undefined) return "Private";
  const digits = currency === "JPY" ? 0 : 2;
  const n = BigInt(minor);
  const base = BigInt(10) ** BigInt(digits);
  return `${currency} ${(n / base).toLocaleString()}${digits ? "." + (n % base).toString().padStart(digits, "0") : ""}`;
}

export function decimalFromMinor(
  minor: string | null | undefined,
  currency: string,
) {
  if (minor == null) return "";
  if (currency === "JPY") return minor;
  const value = minor.padStart(3, "0");
  return value.slice(0, -2) + "." + value.slice(-2);
}
