"use client";

import { useState, useTransition } from "react";

import { revokeAgent } from "../actions";

export function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <input readOnly className="input min-w-0 flex-1" value={link} onFocus={(e) => e.target.select()} aria-label="Link for your AI assistant" />
      <button
        className="btn btn-primary"
        onClick={async () => {
          await navigator.clipboard?.writeText(link).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never");

export function AgentRow({ id, name, prefix, created, lastUsed }: { id: string; name: string; prefix: string; created: string; lastUsed: string | null }) {
  const [pending, start] = useTransition();
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{name}</p>
        <p className="text-xs text-muted">
          Key {prefix}… · connected {when(created)} · last used {when(lastUsed)}
        </p>
      </div>
      <button
        className="btn text-danger"
        disabled={pending}
        onClick={() => confirm(`Revoke "${name}"? It will stop working immediately.`) && start(() => revokeAgent(id))}
      >
        {pending ? "Revoking…" : "Revoke"}
      </button>
    </li>
  );
}
