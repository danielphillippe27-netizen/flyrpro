"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { macNative } from "@/lib/mac-companion/client";
import type { Client } from "@/lib/coco/types";
export function AppleContactsReview({
  userId,
  workspaceId,
  clients,
  onImported,
  onClose,
}: {
  userId: string;
  workspaceId: string;
  clients: Client[];
  onImported: () => Promise<void>;
  onClose: () => void;
}) {
  const started = useRef(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void macNative<{ saved: number }>("contacts-review", {
      userId,
      workspaceId,
      contacts: clients.map((c) => ({
        id: c.id,
        name: `${c.first_name} ${c.last_name}`.trim(),
        phone: c.phone,
        email: c.email,
        identifiers: c.identifiers ?? [],
      })),
    })
      .then(async () => {
        await onImported();
        onClose();
      })
      .catch((e) => setError(e.message));
  }, [userId, workspaceId, clients, onImported, onClose]);
  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Review Apple Contacts"
      >
        <button
          className="modal-close"
          aria-label="Close Apple Contacts"
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <h2>Review Apple Contacts</h2>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button
              className="primary"
              onClick={() =>
                void macNative("privacy-settings", { source: "contacts" })
              }
            >
              Open Contacts Settings
            </button>
          </>
        ) : (
          <p className="muted">
            <Loader2 className="animate-spin" size={18} /> Choose people in the
            Mac review window. Nothing saves until you save the selected batch.
          </p>
        )}
      </div>
    </div>
  );
}
