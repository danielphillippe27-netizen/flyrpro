"use client";
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
type Contact = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
};
type Job = {
  contact_id: string;
  status: string;
  last_error: string | null;
  remote_client_id?: string | null;
  name?: string;
  clientUrl?: string | null;
};
type Status = {
  connected: boolean;
  canManage: boolean;
  connection?: {
    destination_workspace_name: string;
    auto_sync: boolean;
    last_sync_at: string | null;
  };
  jobs: Job[];
};
export function KimiCocoCard({ workspaceId }: { workspaceId?: string }) {
  const [status, setStatus] = useState<Status | null>(null),
    [key, setKey] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [hasMore, setHasMore] = useState(false),
    [showContacts, setShowContacts] = useState(false);
  const load = useCallback(async () => {
    if (!workspaceId) return;
    const response = await fetch(
      `/api/integrations/kimicoco?workspaceId=${encodeURIComponent(workspaceId)}`,
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    setStatus(result);
  }, [workspaceId]);
  useEffect(() => {
    let active = true;
    if (workspaceId)
      void fetch(
        `/api/integrations/kimicoco?workspaceId=${encodeURIComponent(workspaceId)}`,
      )
        .then(async (response) => {
          const result = await response.json();
          if (active) {
            if (response.ok) setStatus(result);
            else setMessage(result.error);
          }
        })
        .catch(() => {
          if (active) setMessage("Could not load KimiCoco settings");
        });
    return () => {
      active = false;
    };
  }, [workspaceId]);
  async function action(
    actionName: string,
    extra: Record<string, unknown> = {},
    method = "POST",
  ) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/integrations/kimicoco", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, action: actionName, ...extra }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setKey("");
      await load();
      setMessage(
        actionName === "connect"
          ? "Connected. New contact saves will transfer automatically."
          : actionName === "sync"
            ? `${result.queued} contacts queued. ${result.synced} transferred in this batch. Remaining transfers continue in the background.`
            : method === "DELETE"
              ? "Disconnected. Imported contacts remain in KimiCoco."
              : "Updated.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not update KimiCoco",
      );
    } finally {
      setBusy(false);
    }
  }
  async function loadContacts(offset = 0) {
    setBusy(true);
    try {
      const response = await fetch(
        `/api/integrations/kimicoco/contacts?workspaceId=${encodeURIComponent(workspaceId ?? "")}&offset=${offset}`,
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setContacts((current) => (offset ? [...current, ...result] : result));
      setHasMore(result.length === 100);
      setShowContacts(true);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not load contacts",
      );
    } finally {
      setBusy(false);
    }
  }
  const names = new Map(
    contacts.map((c) => [c.id, c.full_name || c.email || c.phone || "Contact"]),
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>KimiCoco</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Send names, address, email, phone, notes, appointments, and follow-up
          tasks to KimiCoco.
        </p>
        {status?.connected ? (
          <>
            <p>
              Connected to{" "}
              <strong>{status.connection?.destination_workspace_name}</strong>
            </p>
            {status.connection?.last_sync_at && (
              <p className="text-sm">
                Last transfer:{" "}
                {new Date(status.connection.last_sync_at).toLocaleString()}
              </p>
            )}
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={status.connection?.auto_sync ?? false}
                disabled={busy || !status.canManage}
                onChange={(event) =>
                  void action("settings", { autoSync: event.target.checked })
                }
              />{" "}
              Automatically send new and updated contacts
            </label>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => void loadContacts()}>
                Choose contacts to send
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void action("process")}
              >
                Refresh transfers
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void action("retry")}
              >
                Retry issues
              </Button>
              {status.canManage && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void action("disconnect", {}, "DELETE")}
                >
                  Disconnect
                </Button>
              )}
            </div>
            {showContacts && (
              <div className="space-y-2">
                <p className="text-sm">Select up to 100 contacts per batch.</p>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    setSelected(contacts.slice(0, 100).map((c) => c.id))
                  }
                >
                  Select first 100 shown
                </Button>
                <div className="max-h-64 overflow-auto">
                  {contacts.map((c) => (
                    <label
                      className="flex items-center gap-2 py-2 text-sm"
                      key={c.id}
                    >
                      <input
                        type="checkbox"
                        checked={selected.includes(c.id)}
                        disabled={
                          busy ||
                          (!selected.includes(c.id) && selected.length >= 100)
                        }
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, c.id]
                              : current.filter((id) => id !== c.id),
                          )
                        }
                      />
                      {c.full_name || c.email || c.phone || "Contact"}
                    </label>
                  ))}
                </div>
                {hasMore && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void loadContacts(contacts.length)}
                  >
                    Load more
                  </Button>
                )}
                <Button
                  disabled={busy || !selected.length}
                  onClick={() => void action("sync", { contactIds: selected })}
                >
                  Send {selected.length} selected
                </Button>
              </div>
            )}
            <div className="max-h-64 space-y-2 overflow-auto">
              {status.jobs.map((job) => (
                <div key={job.contact_id} className="text-sm">
                  <span>
                    {names.get(job.contact_id) ||
                      job.name ||
                      `Contact ${job.contact_id.slice(0, 8)}`}{" "}
                    ·{" "}
                    {job.status === "processing"
                      ? "Transferring"
                      : job.status === "needs_attention"
                        ? "Needs attention"
                        : job.status === "synced"
                          ? "Synced"
                          : "Pending"}
                  </span>
                  {job.clientUrl && (
                    <a
                      className="ml-2 underline"
                      href={job.clientUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open in KimiCoco
                    </a>
                  )}
                  {job.last_error && (
                    <p className="text-red-600">{job.last_error}</p>
                  )}
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="text-sm">
              In KimiCoco, open Integrations → WolfGrid → Create connection key,
              then paste it here.
            </p>
            {status?.canManage && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void action("connect", { key: key.trim() });
                }}
                className="space-y-2"
              >
                <label htmlFor="kimicoco-key">KimiCoco connection key</label>
                <Input
                  id="kimicoco-key"
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                  disabled={busy}
                />
                <Button disabled={busy || !key.trim()}>Connect KimiCoco</Button>
              </form>
            )}
            {status && !status.canManage && (
              <p>A workspace owner or admin can connect KimiCoco.</p>
            )}
          </>
        )}
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
