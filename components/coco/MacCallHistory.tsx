"use client";

import { useEffect, useState } from "react";
import { hasMacBridge, macNative } from "@/lib/mac-companion/client";

type MacCall = { startedAt: string; connected: boolean; kind: string; direction: "incoming" | "outgoing"; durationSeconds: number; providerId: string | null };
type CallHistory = { status: "ready" | "unmatched" | "unavailable"; calls: MacCall[] };

export function useMacCallHistory(userId: string, workspaceId: string, contactId?: string | null) {
  const scope = contactId && userId && workspaceId ? [userId, workspaceId, contactId].join(":") : "";
  const [result, setResult] = useState<{ scope: string; history: CallHistory } | null>(null);

  useEffect(() => {
    if (!scope || !hasMacBridge()) return;
    let disposed = false, pending = false, supported: boolean | undefined;
    const refresh = async () => {
      if (disposed || pending || document.hidden || supported === false) return;
      pending = true;
      try {
        supported ??= (await macNative<{ callHistory?: boolean }>("status")).callHistory === true;
        if (!supported || disposed) return;
        const history = await macNative<CallHistory>("call-history", { userId, workspaceId, contactId });
        if (!disposed) setResult({ scope, history });
      } catch {
        if (!disposed && supported) setResult({ scope, history: { status: "unavailable", calls: [] } });
      } finally {
        pending = false;
      }
    };
    void refresh();
    const interval = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      disposed = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [scope, userId, workspaceId, contactId]);

  return result?.scope === scope ? result.history : null;
}

const callTime = new Intl.DateTimeFormat("en-CA", {
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

export function latestMacCall(history: CallHistory | null) {
  const latest = history?.calls.find(call => call.direction === "outgoing");
  return latest ? `${latest.connected ? "Last called" : "Last call attempt"} · ${callTime.format(new Date(latest.startedAt))}` : undefined;
}
