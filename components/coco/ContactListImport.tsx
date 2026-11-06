"use client";
import { useRef, useState } from "react";
import { parse } from "csv-parse/browser/esm/sync";
import { cocoApi } from "@/lib/coco/client";

type Row = { first_name: string; last_name: string; phone: string | null; email: string | null };
export function ContactListImport({ userId, workspaceId, onClose, onImported }: { userId: string; workspaceId: string; onClose: () => void; onImported: () => Promise<void> }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [completed, setCompleted] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  async function read(file?: File) {
    setRows([]); setSelected(new Set()); setCompleted(new Set()); setMessage("");
    if (!file) return;
    if (file.size > 2_000_000) { setMessage("Choose a CSV smaller than 2 MB."); return; }
    setBusy(true);
    try {
      const records = parse(await file.text(), { columns: (headers: string[]) => headers.map(h => h.trim().toLowerCase().replace(/\s+/g, "_")), bom: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
      if (records.length > 500) throw Error("Import up to 500 contacts at a time.");
      const next = records.map(record => {
        const name = (record.name || record.full_name || "").trim().split(/\s+/);
        return { first_name: record.first_name || name[0] || "", last_name: record.last_name || name.slice(1).join(" "), phone: record.phone || null, email: record.email || null };
      });
      if (!next.length || next.some(row => !row.first_name)) throw Error("Each row needs first_name or name. Optional columns: last_name, phone, email.");
      setRows(next); setSelected(new Set(next.map((_, i) => i)));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not read CSV."); }
    finally { setBusy(false); }
  }
  async function save() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage("");
    const remaining = new Set(selected);
    let saved = 0;
    try {
      for (const index of selected) {
        await cocoApi(userId, workspaceId, "create", { ...rows[index], contact_labels: [] });
        remaining.delete(index); saved++;
        setSelected(new Set(remaining));
        setCompleted(current => new Set([...current, index]));
      }
      setMessage(`Added ${saved} contacts.`);
      setRows([]);
    } catch (error) { setMessage(`Added ${saved} contacts. Import stopped: ${error instanceof Error ? error.message : "Could not save"}. Review your contacts before retrying.`); }
    finally { await onImported().catch(() => undefined); setBusy(false); lock.current = false; }
  }
  return <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="list-import-title">
    <button className="modal-close" aria-label="Close list import" disabled={busy} onClick={onClose}>×</button>
    <h2 id="list-import-title">Import a contact list</h2>
    <p className="muted">Choose a CSV with first_name, last_name, phone and email columns. A name or full_name column also works. Selected rows create new contacts; deselect anyone already in your contacts.</p>
    <input aria-label="Contact CSV file" type="file" accept=".csv,text/csv" disabled={busy} onChange={event => void read(event.target.files?.[0])} />
    {rows.length > 0 && <div style={{ maxHeight: 260, overflowY: "auto", marginBlock: 16 }}>{rows.map((row, i) => <label key={i} style={{ display: "flex", gap: 8, padding: 6 }}><input type="checkbox" disabled={busy || completed.has(i)} checked={selected.has(i)} onChange={() => setSelected(current => { const next = new Set(current); if (next.has(i)) next.delete(i); else next.add(i); return next; })} /><span>{row.first_name} {row.last_name} · {row.phone || row.email || "No phone or email"}</span></label>)}</div>}
    {message && <p role="status">{message}</p>}
    <button className="primary" disabled={busy || !selected.size} onClick={() => void save()}>{busy ? "Working…" : `Add ${selected.size} selected contacts`}</button>
  </div></div>;
}
