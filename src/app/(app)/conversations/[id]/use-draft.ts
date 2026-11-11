"use client";

import type { SealedLiveQuery } from "@neon/realtime/client";
import { useLiveQuery } from "@neon/realtime-react";
import { get, set } from "idb-keyval";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ConversationMeta, DraftLine } from "@/lib/data";

export type SyncStatus = "saved" | "saving" | "offline" | "error";

type Stored = {
  meta: ConversationMeta;
  lines: DraftLine[];
  pendingLines: string[];
  pendingMeta: boolean;
};

const storeKey = (userId: string, id: string) => `draft:${userId}:${id}`;

export async function renew<T>(kind: string, conversationId: string): Promise<SealedLiveQuery<T>> {
  const r = await fetch("/api/live", {
    method: "POST",
    cache: "no-store",
    body: JSON.stringify({ kind, conversationId }),
  });
  if (r.status === 401) {
    window.location.assign("/auth/sign-in");
    throw new Error("UNAUTHENTICATED");
  }
  if (!r.ok) throw new Error(`renew failed ${r.status}`);
  return r.json();
}

/**
 * Local-first draft. Every edit is applied in memory, written to IndexedDB at once and
 * queued for the server; the queue survives reloads and offline periods. Server changes
 * arrive through Neon Realtime (or polling if Realtime is unavailable) and are merged per
 * line: a line with unsent local edits keeps the local copy, otherwise the newest wins.
 */
export function useDraft(opts: {
  userId: string;
  conversationId: string;
  initialMeta: ConversationMeta;
  initialLines: DraftLine[];
  sealedDraft: SealedLiveQuery<DraftLine>;
  sealedMeta: SealedLiveQuery<ConversationMeta>;
}) {
  const { userId, conversationId } = opts;
  const [meta, setMeta] = useState(opts.initialMeta);
  const [lines, setLines] = useState<Map<string, DraftLine>>(() => new Map(opts.initialLines.map((l) => [l.id, l])));
  const [status, setStatus] = useState<SyncStatus>("saved");
  const pendingLines = useRef(new Set<string>());
  const pendingMeta = useRef(false);
  const linesRef = useRef(lines);
  const metaRef = useRef(meta);
  linesRef.current = lines;
  metaRef.current = meta;
  const loaded = useRef(false);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushing = useRef(false);

  const persist = useCallback(() => {
    const data: Stored = {
      meta: metaRef.current,
      lines: [...linesRef.current.values()],
      pendingLines: [...pendingLines.current],
      pendingMeta: pendingMeta.current,
    };
    set(storeKey(userId, conversationId), data).catch(() => {});
  }, [userId, conversationId]);

  const hasPending = () => pendingLines.current.size > 0 || pendingMeta.current;

  const flush = useCallback(async () => {
    if (flushing.current || !hasPending()) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return setStatus("offline");
    flushing.current = true;
    setStatus("saving");
    const sentLines = [...pendingLines.current].map((id) => linesRef.current.get(id)).filter((l): l is DraftLine => !!l);
    const sentMeta = pendingMeta.current ? metaRef.current : null;
    try {
      const r = await fetch(`/api/conversations/${conversationId}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meta: sentMeta, lines: sentLines }),
      });
      if (r.status === 401) return window.location.assign("/auth/sign-in");
      if (!r.ok) throw new Error(String(r.status));
      // Only clear what didn't change again while the request was in flight.
      for (const l of sentLines) if (linesRef.current.get(l.id)?.updated_ms === l.updated_ms) pendingLines.current.delete(l.id);
      if (sentMeta && metaRef.current.updated_ms === sentMeta.updated_ms) pendingMeta.current = false;
      persist();
      setStatus(hasPending() ? "saving" : "saved");
    } catch {
      setStatus(navigator.onLine ? "error" : "offline");
      scheduleFlush(5000);
    } finally {
      flushing.current = false;
      if (hasPending()) scheduleFlush(300);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, persist]);

  const scheduleFlush = useCallback(
    (ms = 600) => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(() => void flush(), ms);
    },
    [flush],
  );

  /** Merge server rows into local state, keeping lines with unsent local edits. */
  const mergeServer = useCallback((serverLines: readonly DraftLine[] | undefined, serverMeta?: ConversationMeta) => {
    if (serverLines) {
      setLines((prev) => {
        let changed = false;
        const next = new Map(prev);
        for (const s of serverLines) {
          if (pendingLines.current.has(s.id)) continue;
          const local = next.get(s.id);
          if (!local || s.updated_ms > local.updated_ms) {
            next.set(s.id, { ...s, speed: s.speed == null ? null : Number(s.speed) });
            changed = true;
          }
        }
        if (!changed) return prev;
        linesRef.current = next;
        return next;
      });
    }
    if (serverMeta && !pendingMeta.current && serverMeta.updated_ms > metaRef.current.updated_ms) {
      metaRef.current = serverMeta;
      setMeta(serverMeta);
    }
  }, []);

  // Restore unsent edits from IndexedDB once, then push them.
  useEffect(() => {
    let alive = true;
    get<Stored>(storeKey(userId, conversationId))
      .then((stored) => {
        if (!alive || !stored) return;
        const pend = new Set(stored.pendingLines);
        setLines((prev) => {
          const next = new Map(prev);
          for (const l of stored.lines) {
            const s = next.get(l.id);
            if (pend.has(l.id) || !s || l.updated_ms > s.updated_ms) next.set(l.id, l);
          }
          linesRef.current = next;
          return next;
        });
        pend.forEach((id) => pendingLines.current.add(id));
        if (stored.pendingMeta && stored.meta.updated_ms > metaRef.current.updated_ms) {
          pendingMeta.current = true;
          metaRef.current = stored.meta;
          setMeta(stored.meta);
        }
      })
      .catch(() => {})
      .finally(() => {
        loaded.current = true;
        persist();
        if (hasPending()) scheduleFlush(100);
      });
    const online = () => scheduleFlush(100);
    const offline = () => setStatus("offline");
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      alive = false;
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, conversationId]);

  // Live updates from other devices.
  const [draftQuery] = useState(opts.sealedDraft);
  const [metaQuery] = useState(opts.sealedMeta);
  const liveDraft = useLiveQuery(draftQuery, {
    initialData: opts.initialLines,
    refreshQuery: () => renew<DraftLine>("draft", conversationId),
  });
  const liveMeta = useLiveQuery(metaQuery, {
    initialData: [opts.initialMeta],
    refreshQuery: () => renew<ConversationMeta>("meta", conversationId),
  });
  useEffect(() => mergeServer(liveDraft.data), [liveDraft.data, mergeServer]);
  useEffect(() => mergeServer(undefined, liveMeta.data?.[0]), [liveMeta.data, mergeServer]);

  // Fallback: poll when Realtime isn't live.
  const live = liveDraft.status === "live";
  useEffect(() => {
    if (live) return;
    const t = setInterval(async () => {
      if (!navigator.onLine) return;
      const r = await fetch(`/api/conversations/${conversationId}/sync`, { cache: "no-store" }).catch(() => null);
      if (r?.ok) {
        const j = (await r.json()) as { meta: ConversationMeta; lines: DraftLine[] };
        mergeServer(j.lines, j.meta);
      }
    }, 5000);
    return () => clearInterval(t);
  }, [live, conversationId, mergeServer]);

  // ------------------------------------------------------------ edit API
  const touch = (old?: DraftLine) => Math.max(Date.now(), (old?.updated_ms ?? 0) + 1);

  const commit = useCallback(
    (changed: DraftLine[]) => {
      setLines((prev) => {
        const next = new Map(prev);
        for (const l of changed) {
          next.set(l.id, l);
          pendingLines.current.add(l.id);
        }
        linesRef.current = next;
        return next;
      });
      persist();
      setStatus("saving");
      scheduleFlush();
    },
    [persist, scheduleFlush],
  );

  const ordered = useMemo(
    () => [...lines.values()].filter((l) => !l.deleted).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)),
    [lines],
  );

  const updateLine = useCallback(
    (id: string, patch: Partial<Omit<DraftLine, "id" | "updated_ms">>) => {
      const old = linesRef.current.get(id);
      if (old) commit([{ ...old, ...patch, updated_ms: touch(old) }]);
    },
    [commit],
  );

  const addLine = useCallback(
    (afterId: string | null, characterId: string | null) => {
      const list = [...linesRef.current.values()].filter((l) => !l.deleted).sort((a, b) => a.position - b.position);
      const i = afterId ? list.findIndex((l) => l.id === afterId) : list.length - 1;
      const before = list[i]?.position ?? 0;
      const after = list[i + 1]?.position ?? before + 2;
      const line: DraftLine = {
        id: crypto.randomUUID(),
        position: (before + after) / 2,
        character_id: characterId,
        text: "",
        emotion: "neutral",
        speed: null,
        deleted: false,
        updated_ms: Date.now(),
      };
      commit([line]);
      return line.id;
    },
    [commit],
  );

  const moveLine = useCallback(
    (id: string, dir: -1 | 1) => {
      const list = [...linesRef.current.values()].filter((l) => !l.deleted).sort((a, b) => a.position - b.position);
      const i = list.findIndex((l) => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return;
      const a = list[i];
      const b = list[j];
      commit([
        { ...a, position: b.position, updated_ms: touch(a) },
        { ...b, position: a.position, updated_ms: touch(b) },
      ]);
    },
    [commit],
  );

  /** Replace the whole draft (used to load an older version back into the editor). */
  const replaceAll = useCallback(
    (rows: { id: string; character_id: string; text: string; emotion: string; speed: number }[]) => {
      const keep = new Set(rows.map((r) => r.id));
      const changed: DraftLine[] = [];
      for (const l of linesRef.current.values()) if (!keep.has(l.id) && !l.deleted) changed.push({ ...l, deleted: true, updated_ms: touch(l) });
      rows.forEach((r, i) => {
        const old = linesRef.current.get(r.id);
        changed.push({ id: r.id, position: i + 1, character_id: r.character_id, text: r.text, emotion: r.emotion, speed: r.speed, deleted: false, updated_ms: touch(old) });
      });
      commit(changed);
    },
    [commit],
  );

  const updateMeta = useCallback(
    (patch: Partial<Pick<ConversationMeta, "title" | "pause_ms">>) => {
      const next = { ...metaRef.current, ...patch, updated_ms: Math.max(Date.now(), metaRef.current.updated_ms + 1) };
      metaRef.current = next;
      setMeta(next);
      pendingMeta.current = true;
      persist();
      setStatus("saving");
      scheduleFlush();
    },
    [persist, scheduleFlush],
  );

  /** Resolves once every queued edit has reached the server. */
  const flushNow = useCallback(async () => {
    for (let i = 0; i < 20 && hasPending(); i++) {
      await flush();
      if (hasPending()) await new Promise((r) => setTimeout(r, 300));
    }
    return !hasPending();
  }, [flush]);

  return { meta, lines: ordered, status, realtime: liveDraft.status, updateLine, addLine, moveLine, replaceAll, updateMeta, flushNow };
}
