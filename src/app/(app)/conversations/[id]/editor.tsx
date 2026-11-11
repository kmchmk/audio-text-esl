"use client";

import type { SealedLiveQuery } from "@neon/realtime/client";
import Link from "next/link";
import { useRef, useState } from "react";

import type { CharacterView, ConversationMeta, DraftLine } from "@/lib/data";
import { EMOTIONS } from "@/lib/emotions";
import type { LiveGeneration } from "@/lib/live";
import { formatThb } from "@/lib/money";

import { findModel, useCatalog } from "../../use-catalog";
import { History } from "./history";
import { useDraft, type SyncStatus } from "./use-draft";

const SPEEDS = [0.7, 0.8, 0.9, 1, 1.1, 1.2, 1.3];

export function Editor(props: {
  userId: string;
  initialMeta: ConversationMeta;
  initialLines: DraftLine[];
  characters: CharacterView[];
  sealedDraft: SealedLiveQuery<DraftLine>;
  sealedMeta: SealedLiveQuery<ConversationMeta>;
  sealedGenerations: SealedLiveQuery<LiveGeneration>;
}) {
  const { characters } = props;
  const draft = useDraft({
    userId: props.userId,
    conversationId: props.initialMeta.id,
    initialMeta: props.initialMeta,
    initialLines: props.initialLines,
    sealedDraft: props.sealedDraft,
    sealedMeta: props.sealedMeta,
  });
  const catalog = useCatalog();
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const charById = new Map(characters.map((c) => [c.id, c]));

  const estimate = draft.lines.reduce((sum, l) => {
    const c = l.character_id ? charById.get(l.character_id) : undefined;
    const m = c && findModel(catalog, c.provider, c.model);
    return sum + (m ? (m.est_template_usd / 995) * l.text.length : 0);
  }, 0);

  /** Default speaker for a new line inserted at `newIdx`: whoever spoke two lines up, so turns alternate. */
  function nextSpeaker(newIdx: number) {
    const l = draft.lines;
    const prev = l[newIdx - 1]?.character_id;
    const twoUp = l[newIdx - 2]?.character_id;
    if (twoUp && twoUp !== prev) return twoUp;
    return characters.find((c) => c.id !== prev)?.id ?? prev ?? characters[0]?.id ?? null;
  }

  function add(afterId: string | null, idx: number) {
    const id = draft.addLine(afterId, nextSpeaker(idx));
    setTimeout(() => textRefs.current.get(id)?.focus(), 30);
  }

  async function convert() {
    setError(null);
    setConverting(true);
    try {
      if (!(await draft.flushNow())) throw new Error("Couldn't save your latest edits. Check your connection and try again.");
      const r = await fetch(`/api/conversations/${draft.meta.id}/generate`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't start the conversion.");
      window.dispatchEvent(new Event("history:refresh"));
      document.getElementById("history")?.scrollIntoView({ behavior: "smooth" });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setConverting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/" className="text-sm text-muted hover:text-fg">
          ← Conversations
        </Link>
        <Status status={draft.status} realtime={draft.realtime} />
      </div>

      <section className="card space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="w-full min-w-0 flex-1 space-y-1 sm:w-auto sm:min-w-60">
            <span className="text-sm font-medium">Title</span>
            <input className="input w-full text-base" value={draft.meta.title} onChange={(e) => draft.updateMeta({ title: e.target.value })} />
          </label>
          <label className="w-full space-y-1 sm:w-56">
            <span className="text-sm font-medium">Pause between lines: {(draft.meta.pause_ms / 1000).toFixed(1)} s</span>
            <input
              type="range"
              min={0}
              max={2500}
              step={100}
              className="w-full"
              value={draft.meta.pause_ms}
              onChange={(e) => draft.updateMeta({ pause_ms: Number(e.target.value) })}
            />
          </label>
        </div>

        {characters.length === 0 && (
          <p className="rounded-md bg-accent-soft p-3 text-sm">
            You have no characters yet. <Link className="underline" href="/characters">Create one</Link> to choose speakers.
          </p>
        )}

        <ol className="space-y-2" data-tour="lines">
          {draft.lines.map((l, i) => {
            const c = l.character_id ? charById.get(l.character_id) : undefined;
            const m = c && findModel(catalog, c.provider, c.model);
            const noEmotion = m?.emotion === "none";
            return (
              <li key={l.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line p-2 lg:flex-nowrap lg:items-start">
                <span className="order-1 w-6 text-right text-xs text-muted lg:pt-2">{i + 1}</span>
                <select
                  className="input order-2 min-w-0 flex-1 sm:max-w-64 lg:w-32 lg:flex-none"
                  value={l.character_id ?? ""}
                  onChange={(e) => draft.updateLine(l.id, { character_id: e.target.value || null })}
                  aria-label="Speaker"
                >
                  <option value="">Speaker…</option>
                  {characters.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.name}
                    </option>
                  ))}
                  {l.character_id && !c && <option value={l.character_id}>(removed)</option>}
                </select>
                <textarea
                  ref={(el) => {
                    if (el) textRefs.current.set(l.id, el);
                    else textRefs.current.delete(l.id);
                  }}
                  rows={1}
                  className="input order-4 min-h-[2.4rem] basis-full resize-none [field-sizing:content] lg:order-3 lg:min-w-0 lg:basis-auto lg:flex-1"
                  placeholder="Type what this person says…"
                  value={l.text}
                  onChange={(e) => draft.updateLine(l.id, { text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      add(l.id, i + 1);
                    }
                  }}
                />
                <select
                  className="input order-5 min-w-0 flex-1 lg:order-4 lg:w-28 lg:flex-none"
                  value={l.emotion}
                  onChange={(e) => draft.updateLine(l.id, { emotion: e.target.value })}
                  aria-label="Emotion"
                  title={noEmotion ? `${c?.name}'s voice can't show emotions. Pick a voice marked "emotions" to use this.` : "Emotion"}
                  style={noEmotion ? { opacity: 0.55 } : undefined}
                >
                  {EMOTIONS.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.label}
                    </option>
                  ))}
                </select>
                <select
                  className="input order-6 min-w-0 flex-1 lg:order-5 lg:w-28 lg:flex-none"
                  value={l.speed ?? ""}
                  onChange={(e) => draft.updateLine(l.id, { speed: e.target.value ? Number(e.target.value) : null })}
                  aria-label="Speed"
                >
                  <option value="">Speed: {c ? `${c.default_speed}×` : "default"}</option>
                  {SPEEDS.map((s) => (
                    <option key={s} value={s}>
                      {s.toFixed(1)}×
                    </option>
                  ))}
                </select>
                <div className="order-3 ml-auto flex shrink-0 gap-0.5 lg:order-6 lg:ml-0">
                  <button className="btn btn-ghost icon-btn" title="Move up" onClick={() => draft.moveLine(l.id, -1)} disabled={i === 0}>
                    ↑
                  </button>
                  <button className="btn btn-ghost icon-btn" title="Move down" onClick={() => draft.moveLine(l.id, 1)} disabled={i === draft.lines.length - 1}>
                    ↓
                  </button>
                  <button className="btn btn-ghost icon-btn text-muted" title="Delete line" onClick={() => draft.updateLine(l.id, { deleted: true })}>
                    ✕
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
        <button className="btn" onClick={() => add(draft.lines.at(-1)?.id ?? null, draft.lines.length)}>
          + Add line
        </button>
        <p className="text-xs text-muted">Tip: press Enter to add the next line. Shift+Enter makes a line break.</p>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <button className="btn btn-primary w-full sm:w-auto" onClick={convert} disabled={converting || draft.lines.length === 0} data-tour="convert">
            {converting ? "Starting…" : "Convert to audio conversation"}
          </button>
          {catalog && (
            <span className="text-sm text-muted">
              {estimate > 0 ? `Estimated cost: up to ${formatThb(estimate, catalog.rate)} (unchanged lines are reused for free)` : "Free with the current voices"}
            </span>
          )}
          {error && <p className="w-full text-sm text-danger">{error}</p>}
        </div>
      </section>

      <History
        conversationId={draft.meta.id}
        sealedGenerations={props.sealedGenerations}
        rate={catalog?.rate ?? null}
        onRestore={(rows) => {
          draft.replaceAll(rows);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />
    </div>
  );
}

function Status({ status, realtime }: { status: SyncStatus; realtime: string }) {
  const text = {
    saved: "All changes saved",
    saving: "Saving…",
    offline: "Offline: changes are kept on this device and sync when you're back",
    error: "Couldn't reach the server: retrying",
  }[status];
  return (
    <span className="ml-auto flex items-center gap-2 text-xs text-muted" title={`Live sync: ${realtime}`}>
      <span className={`inline-block size-2 rounded-full ${status === "saved" ? "bg-ok" : status === "saving" ? "bg-accent" : "bg-danger"}`} />
      {text}
    </span>
  );
}
