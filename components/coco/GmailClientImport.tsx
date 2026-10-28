"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, LoaderCircle, X } from "lucide-react";
import { createClient as supabase } from "@/lib/supabase/client";
import { mergeCandidates } from "@/lib/coco/gmail-merge";
import type { DealCandidate } from "@/lib/coco/gmail-import";

type Props = {
  userId: string;
  workspaceId: string;
  connected: boolean;
  configured: boolean;
  onConnect: () => void;
  onClose: () => void;
  onImported: () => Promise<void>;
};

export function GmailClientImport({
  userId,
  workspaceId,
  connected,
  configured,
  onConnect,
  onClose,
  onImported,
}: Props) {
  const [candidates, setCandidates] = useState<DealCandidate[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [pausing, setPausing] = useState(false);
  const [saved, setSaved] = useState(0);
  const [scanned, setScanned] = useState(0);
  const [complete, setComplete] = useState(false);
  const [message, setMessage] = useState("");
  const [consent, setConsent] = useState(false);
  const [after, setAfter] = useState("");
  const [before, setBefore] = useState("");
  const storageKey = `wolfgrid-gmail-import:${userId}:${workspaceId}`;
  const [restored, setRestored] = useState(false);
  const stop = useRef(false);
  const cursor = useRef<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const cached = sessionStorage.getItem(storageKey);
        if (cached) {
          const data = JSON.parse(cached);
          setCandidates(mergeCandidates([], data.candidates ?? []));
          setScanned(data.scanned ?? 0);
          setComplete(Boolean(data.complete));
          setAfter(data.after ?? "");
          setBefore(data.before ?? "");
          cursor.current = data.cursor;
          started.current = true;
        }
      } catch {
        sessionStorage.removeItem(storageKey);
      }
      setRestored(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [storageKey]);
  useEffect(() => {
    if (restored)
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          candidates,
          scanned,
          complete,
          after,
          before,
          cursor: cursor.current,
        }),
      );
  }, [candidates, scanned, complete, after, before, restored, storageKey]);
  useEffect(
    () => () => {
      stop.current = true;
    },
    [],
  );
  useEffect(() => {
    if (!scanning && !saving) return;
    const start = Date.now();
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [scanning, saving]);

  async function scan() {
    if (!started.current || complete) {
      setCandidates([]);
      setSelected([]);
      setScanned(0);
      setComplete(false);
      cursor.current = null;
      started.current = true;
    }
    setMessage("");
    setElapsed(0);
    setPausing(false);
    setScanning(true);
    stop.current = false;
    let pageToken: string | null = cursor.current;
    let count = complete ? 0 : scanned;
    try {
      const { data: session } = await supabase().auth.getSession();
      if (!session.session) throw new Error("Sign in again to scan Gmail");
      do {
        const response: Response = await fetch("/api/coco/gmail/import/scan", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-wolfgrid-user-id": userId,
          },
          body: JSON.stringify({
            workspace_id: workspaceId,
            page_token: pageToken,
            consent,
            after,
            before,
          }),
        });
        const result = (await response.json()) as {
          error?: string;
          candidates?: DealCandidate[];
          scanned?: number;
          warnings?: string[];
          nextPageToken?: string | null;
        };
        if (!response.ok)
          throw new Error(result.error ?? "Could not scan Gmail");
        const found = result.candidates ?? [];
        setCandidates((current) => mergeCandidates(current, found));
        if (result.warnings?.length) setMessage(result.warnings.join(" · "));
        count += result.scanned ?? 0;
        setScanned(count);
        pageToken = result.nextPageToken ?? null;
        cursor.current = pageToken;
      } while (pageToken && !stop.current);
      setComplete(!pageToken);
      setMessage(
        pageToken
          ? "Scan paused. Resume to check the remaining emails."
          : "Scan complete. Review each possible client and deal before importing.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  function update(id: string, patch: Partial<DealCandidate>) {
    setCandidates((current) =>
      current.map((item) =>
        item.messageId === id ? { ...item, ...patch } : item,
      ),
    );
  }

  async function save() {
    setSaving(true);
    setElapsed(0);
    setSaved(0);
    setMessage("");
    let imported = 0;
    try {
      const { data: session } = await supabase().auth.getSession();
      if (!session.session) throw new Error("Sign in again to import clients");
      for (const candidate of candidates.filter((item) =>
        selected.includes(item.messageId),
      )) {
        const response = await fetch("/api/coco/gmail/import/save", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-wolfgrid-user-id": userId,
          },
          body: JSON.stringify({ workspace_id: workspaceId, candidate }),
        });
        const result = (await response.json()) as { error?: string };
        if (!response.ok)
          throw new Error(
            `${candidate.name}: ${result.error ?? "Import failed"}`,
          );
        imported++;
        setSaved(imported);
      }
      await onImported();
      setMessage(
        `Imported ${imported} selected deal records. Existing clients were matched by email.`,
      );
      setSelected([]);
    } catch (error) {
      setMessage(
        `${imported} saved. ${error instanceof Error ? error.message : "Import failed"}`,
      );
      await onImported();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal gmail-import-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Import past clients from Gmail"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="modal-close"
          aria-label="Close import"
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <span className="eyebrow">YOUR PAST RELATIONSHIPS</span>
        <h2>Find past clients in Gmail</h2>
        <p>
          Checks all Gmail threads across your connected mailbox, including sent
          mail, archives, spam, and trash. Leave dates blank for your entire
          available history. Possible matches need your review because email
          alone cannot prove who was a client. Selected names and deal details
          become visible in this workspace; email bodies and supported PDF
          attachments are sent to OpenAI for analysis. Raw emails and PDFs are
          not saved in the CRM. All messages and up to three PDFs per thread are
          analyzed; omitted attachments are flagged.
        </p>
        {!connected ? (
          <button
            className="primary"
            disabled={!configured}
            onClick={onConnect}
          >
            {configured ? "Connect Gmail" : "Gmail setup pending"}{" "}
            <ArrowRight size={15} />
          </button>
        ) : (
          <>
            <label className="gmail-context-toggle">
              <input
                type="checkbox"
                checked={consent}
                disabled={scanning}
                onChange={(event) => setConsent(event.target.checked)}
              />
              Allow OpenAI to analyze matching email threads and PDFs to find my
              clients and deal details.
            </label>
            <button
              type="button"
              disabled={scanning || saving}
              onClick={() => {
                stop.current = true;
                cursor.current = null;
                started.current = false;
                setAfter("");
                setBefore("");
                setScanned(0);
                setComplete(false);
              }}
            >
              Scan all time (restart from beginning)
            </button>
            <div className="gmail-import-fields">
              <label>
                From date
                <input
                  type="date"
                  value={after}
                  disabled={(scanning || scanned > 0) && !complete}
                  onChange={(event) => setAfter(event.target.value)}
                />
              </label>
              <label>
                Before date (exclusive)
                <input
                  type="date"
                  value={before}
                  disabled={(scanning || scanned > 0) && !complete}
                  onChange={(event) => setBefore(event.target.value)}
                />
              </label>
            </div>
            <p>
              Leave both dates blank to scan all time. You can pause and resume
              in this browser tab; closing the tab ends the scan.
            </p>
            <div className="gmail-import-actions">
              <button
                className="primary"
                onClick={() => void scan()}
                disabled={scanning || saving || !consent || !restored}
              >
                {scanning ? (
                  <>
                    <LoaderCircle
                      size={16}
                      className="gmail-progress-spinner"
                      aria-hidden="true"
                    />{" "}
                    Scanning…
                  </>
                ) : scanned > 0 && !complete ? (
                  "Resume scan"
                ) : (
                  "Scan Gmail"
                )}
              </button>
              {scanning && (
                <button
                  disabled={pausing}
                  onClick={() => {
                    stop.current = true;
                    setPausing(true);
                  }}
                >
                  {pausing ? "Pausing…" : "Pause scan"}
                </button>
              )}
              <span aria-live="polite">
                {scanned} threads checked · {candidates.length} possible client
                deals
              </span>
            </div>
            {(scanning || saving) && (
              <div className="gmail-scan-progress" role="status">
                <LoaderCircle
                  size={20}
                  className="gmail-progress-spinner"
                  aria-hidden="true"
                />
                <div>
                  <strong>
                    {saving
                      ? `Saving ${saved} of ${selected.length} selected deals`
                      : pausing
                        ? "Finishing the current thread before pausing…"
                        : `Checking thread ${scanned + 1} for client and deal details…`}
                  </strong>
                  <small>
                    {Math.floor(elapsed / 60)}:
                    {String(elapsed % 60).padStart(2, "0")} elapsed
                    {scanning
                      ? " · Gmail search and AI analysis can take a minute per thread. Results appear as each thread finishes."
                      : " · Your client list will update when saving finishes."}
                  </small>
                </div>
              </div>
            )}
            {message && (
              <p role="status" className="gmail-import-status">
                {message}
              </p>
            )}
            {candidates.length > 0 && (
              <>
                <div className="gmail-import-list">
                  {candidates.map((item) => (
                    <div className="gmail-import-row" key={item.messageId}>
                      <label className="gmail-import-select">
                        <input
                          type="checkbox"
                          checked={selected.includes(item.messageId)}
                          onChange={(event) =>
                            setSelected((current) =>
                              event.target.checked
                                ? [...current, item.messageId]
                                : current.filter((id) => id !== item.messageId),
                            )
                          }
                        />
                        <strong>{item.name}</strong>
                      </label>
                      <small>
                        {item.email} ·{" "}
                        {item.messageDate
                          ? new Date(item.messageDate).toLocaleDateString(
                              "en-CA",
                            )
                          : "Date unknown"}
                      </small>
                      <p>
                        {item.confidence ?? "Unknown"} confidence ·{" "}
                        {item.status ?? "uncertain"}
                      </p>
                      {item.warnings?.map((warning, index) => (
                        <p key={index} role="note">
                          Review: {warning}
                        </p>
                      ))}
                      {item.sources?.map((id) => (
                        <a
                          key={id}
                          href={`https://mail.google.com/mail/u/0/#all/${encodeURIComponent(id)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open source email{" "}
                        </a>
                      ))}
                      <p>
                        Evidence: {item.subject || "No subject"} ·{" "}
                        {item.evidenceExcerpt}
                      </p>
                      <div className="gmail-import-fields">
                        <label>
                          Name
                          <input
                            value={item.name}
                            onChange={(event) =>
                              update(item.messageId, {
                                name: event.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          Email
                          <input
                            type="email"
                            value={item.email}
                            onChange={(event) =>
                              update(item.messageId, {
                                email: event.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          Phone
                          <input
                            value={item.phone ?? ""}
                            onChange={(event) =>
                              update(item.messageId, {
                                phone: event.target.value || null,
                              })
                            }
                          />
                        </label>
                        <label>
                          Property
                          <input
                            value={item.propertyAddress ?? ""}
                            onChange={(event) =>
                              update(item.messageId, {
                                propertyAddress: event.target.value || null,
                              })
                            }
                          />
                        </label>
                        <label>
                          Side
                          <select
                            value={item.side ?? ""}
                            onChange={(event) =>
                              update(item.messageId, {
                                side:
                                  (event.target
                                    .value as DealCandidate["side"]) || null,
                              })
                            }
                          >
                            <option value="">Unknown</option>
                            <option value="buyer">Buyer</option>
                            <option value="seller">Seller</option>
                          </select>
                        </label>
                        <label>
                          Price
                          <input
                            type="number"
                            min="0"
                            value={item.price ?? ""}
                            onChange={(event) =>
                              update(item.messageId, {
                                price: event.target.value
                                  ? Number(event.target.value)
                                  : null,
                              })
                            }
                          />
                        </label>
                        <label>
                          Closing date
                          <input
                            type="date"
                            value={item.closingDate ?? ""}
                            onChange={(event) =>
                              update(item.messageId, {
                                closingDate: event.target.value || null,
                              })
                            }
                          />
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="gmail-import-footer">
                  <span>{selected.length} selected</span>
                  <button
                    type="button"
                    onClick={() =>
                      setSelected(
                        selected.length === candidates.length
                          ? []
                          : candidates.map((item) => item.messageId),
                      )
                    }
                  >
                    {selected.length === candidates.length
                      ? "Clear selection"
                      : "Select all"}
                  </button>
                  <button
                    className="primary"
                    disabled={
                      saving || scanning || selected.length === 0 || !complete
                    }
                    onClick={() => void save()}
                  >
                    {saving ? "Importing…" : "Import selected clients"}
                  </button>
                </div>
                {!complete && (
                  <small>
                    Finish the scan before importing so you can review the full
                    result.
                  </small>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
