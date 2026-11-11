"use client";

import type { SealedLiveQuery } from "@neon/realtime/client";
import { useLiveQuery } from "@neon/realtime-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { conversationPdf } from "@/components/pdf";
import { Player } from "@/components/player";
import { WorksheetDialog } from "@/components/worksheet-dialog";
import { EMOTIONS } from "@/lib/emotions";
import type { HistoryEntry } from "@/lib/history";
import type { LiveGeneration } from "@/lib/live";
import { formatThb } from "@/lib/money";

import { createShare, revokeShare } from "../../actions";
import { renew } from "./use-draft";

type RestoreRow = { id: string; character_id: string; text: string; emotion: string; speed: number };

const fmtTime = (ms: number | null) => {
  if (ms == null) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function History({
  conversationId,
  sealedGenerations,
  rate,
  onRestore,
}: {
  conversationId: string;
  sealedGenerations: SealedLiveQuery<LiveGeneration>;
  rate: number | null;
  onRestore: (rows: RestoreRow[]) => void;
}) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [query] = useState(sealedGenerations);
  const live = useLiveQuery(query, { refreshQuery: () => renew<LiveGeneration>("generations", conversationId) });
  const kicked = useRef(new Set<string>());

  const load = useCallback(async () => {
    const r = await fetch(`/api/conversations/${conversationId}/history`, { cache: "no-store" });
    if (r.ok) setEntries(await r.json());
  }, [conversationId]);

  // Reload the history whenever a generation's status or progress changes.
  const signature = (live.data ?? []).map((g) => `${g.id}:${g.status}:${g.done_items}`).join("|");
  useEffect(() => {
    void load();
    if (signature.includes(":done:")) window.dispatchEvent(new Event("budget:refresh"));
  }, [signature, load]);

  // The editor announces new conversions so the list updates even before Realtime does.
  useEffect(() => {
    const h = () => void load();
    window.addEventListener("history:refresh", h);
    return () => window.removeEventListener("history:refresh", h);
  }, [load]);

  // Fallback polling while something is in progress and Realtime isn't live.
  const busy = entries?.some((e) => e.status === "queued" || e.status === "running");
  useEffect(() => {
    if (!busy || live.status === "live") return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [busy, live.status, load]);

  // Restart work whose worker stopped (for example, a function timeout).
  useEffect(() => {
    for (const e of entries ?? []) {
      if (e.stalled && !kicked.current.has(e.id)) {
        kicked.current.add(e.id);
        void fetch(`/api/generations/${e.id}`, { method: "POST", body: JSON.stringify({ action: "kick" }) });
      }
    }
  }, [entries]);

  return (
    <section id="history" className="space-y-3">
      <h2 className="text-lg font-semibold">History</h2>
      {entries === null ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="card p-4 text-sm text-muted">No audio yet. Click "Convert to audio conversation" to create version 1.</p>
      ) : (
        entries.map((e, i) => <Entry key={e.id} e={e} latest={i === 0} rate={rate} onRestore={onRestore} reload={load} />)
      )}
    </section>
  );
}

function Entry({
  e,
  latest,
  rate,
  onRestore,
  reload,
}: {
  e: HistoryEntry;
  latest: boolean;
  rate: number | null;
  onRestore: (rows: RestoreRow[]) => void;
  reload: () => Promise<void>;
}) {
  const [open, setOpen] = useState(latest);
  const [worksheet, setWorksheet] = useState(false);
  const [showLines, setShowLines] = useState(false);
  const pdfLines = e.lines.map((l) => ({ character: l.character, text: l.text }));
  const changed = e.characters.filter((c) => c.changes.length || c.deleted);
  const when = new Date(e.created_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  return (
    <article className="card p-4">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button className="font-semibold" onClick={() => setOpen(!open)}>
          {open ? "▾" : "▸"} Version {e.version}
        </button>
        <span className="text-sm text-muted">{when}</span>
        {e.status === "done" && <span className="chip">{fmtTime(e.duration_ms)}</span>}
        <span className="chip" title="Actual cost reported by the voice service">
          {rate != null ? formatThb(e.cost_usd, rate) : ""}
        </span>
        <StatusBadge e={e} />
      </header>

      {(e.status === "queued" || e.status === "running") && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-bg">
          <div className="h-full bg-accent transition-all" style={{ width: `${(100 * e.done_items) / Math.max(1, e.total_items)}%` }} />
        </div>
      )}
      {e.status === "failed" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <p className="text-danger">{e.error}</p>
          <button
            className="btn"
            onClick={async () => {
              await fetch(`/api/generations/${e.id}`, { method: "POST", body: JSON.stringify({ action: "retry" }) });
              await reload();
            }}
          >
            Retry
          </button>
        </div>
      )}

      {changed.length > 0 && (
        <div className="mt-3 rounded-md bg-bg p-2 text-xs text-muted">
          <p className="font-medium text-fg">Characters have changed since this version:</p>
          <ul className="mt-1 space-y-0.5">
            {changed.map((c) => (
              <li key={c.name + c.version}>
                <span className="font-medium">
                  {c.name} (v{c.version})
                </span>
                {c.deleted ? " was removed." : ": " + c.changes.map((x) => `${x.field} ${x.then} → ${x.now}`).join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}

      {open && (
        <div className="mt-4 space-y-4">
          {e.status === "done" && e.audio_url ? (
            <Player src={e.audio_url} lines={e.lines} />
          ) : (
            <ol className="space-y-1 text-sm">
              {e.lines.map((l, i) => (
                <li key={i}>
                  <span className="font-medium">{l.character}:</span> {l.text}
                </li>
              ))}
            </ol>
          )}
          <p className="text-xs text-muted">
            Voices used: {e.characters.map((c) => `${c.name} (v${c.version}, ${c.voice})`).join(" · ")} · pause {e.pause_ms / 1000}s
          </p>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {e.download_url && (
              <a className="btn btn-primary" href={e.download_url}>
                Download MP3
              </a>
            )}
            {e.status === "done" && (
              <button className="btn" onClick={() => setShowLines(!showLines)}>
                Single lines
              </button>
            )}
            <button className="btn" onClick={() => conversationPdf(e.title, pdfLines)}>
              Script PDF
            </button>
            <button className="btn" onClick={() => setWorksheet(true)}>
              Worksheet PDF
            </button>
            {e.status === "done" && <ShareControls e={e} reload={reload} />}
            <button
              className="btn btn-ghost"
              onClick={() =>
                confirm(`Replace the editor's lines with version ${e.version}? You can convert it again afterwards.`) &&
                onRestore(e.lines.map((l) => ({ id: l.id, character_id: l.character_id, text: l.text, emotion: l.emotion, speed: l.speed })))
              }
            >
              Edit this version
            </button>
          </div>
          {showLines && (
            <ol className="space-y-1 text-sm">
              {e.lines.map((l, i) => (
                <li key={i} className="flex items-center gap-2">
                  {l.clip_url && (
                    <a className="btn px-2 py-0.5 text-xs" href={l.clip_url}>
                      MP3
                    </a>
                  )}
                  <span className="text-muted">{i + 1}.</span>
                  <span>
                    <span className="font-medium">{l.character}</span>{" "}
                    <span className="chip">
                      {EMOTIONS.find((x) => x.id === l.emotion)?.label} · {l.speed}×
                    </span>{" "}
                    {l.text}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {worksheet && <WorksheetDialog title={e.title} lines={pdfLines} onClose={() => setWorksheet(false)} />}
    </article>
  );
}

function StatusBadge({ e }: { e: HistoryEntry }) {
  if (e.status === "done") return null;
  const text =
    e.status === "failed"
      ? "Failed"
      : e.status === "queued"
        ? "Waiting to start… (the free voice may take ~30 s to warm up)"
        : `Generating ${e.done_items}/${e.total_items}`;
  return <span className={`text-sm ${e.status === "failed" ? "text-danger" : "text-muted"}`}>{text}</span>;
}

function ShareControls({ e, reload }: { e: HistoryEntry; reload: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [hide, setHide] = useState(false);
  const [busy, setBusy] = useState(false);
  const url = (t: string) => `${window.location.origin}/s/${t}`;
  return (
    <span className="relative grid sm:block">
      <button className="btn" onClick={() => setOpen(!open)}>
        Share{e.shares.length ? ` (${e.shares.length})` : ""}
      </button>
      {open && (
        <div className="card fixed inset-x-3 bottom-3 z-40 max-h-[70vh] space-y-3 overflow-y-auto p-4 text-sm shadow-2xl lg:absolute lg:inset-x-auto lg:bottom-auto lg:left-0 lg:mt-1 lg:w-80 lg:p-3 lg:shadow-lg">
          <div className="flex items-start gap-2">
            <p className="flex-1 text-muted">Anyone with the link can listen to version {e.version} without signing in.</p>
            <button className="btn btn-ghost icon-btn -mt-1" aria-label="Close" onClick={() => setOpen(false)}>
              ✕
            </button>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={hide} onChange={(x) => setHide(x.target.checked)} />
            Hide the transcript (for listening tests)
          </label>
          <button
            className="btn btn-primary w-full"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const token = await createShare(e.id, hide);
              await navigator.clipboard?.writeText(url(token)).catch(() => {});
              await reload();
              setBusy(false);
            }}
          >
            Create link and copy
          </button>
          {e.shares.length > 0 && (
            <ul className="space-y-2 border-t border-line pt-2">
              {e.shares.map((s) => (
                <li key={s.token} className="flex items-center gap-2">
                  <input readOnly className="input min-w-0 flex-1 text-xs" value={url(s.token)} onFocus={(x) => x.target.select()} />
                  <span className="chip">{s.hide_transcript ? "no text" : "with text"}</span>
                  <button
                    className="btn btn-ghost icon-btn text-danger"
                    title="Revoke link"
                    onClick={async () => {
                      if (!confirm("Revoke this link? It will stop working immediately.")) return;
                      await revokeShare(s.token);
                      await reload();
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </span>
  );
}
