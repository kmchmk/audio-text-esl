"use client";

import { useTransition } from "react";

import { removeConversation } from "./actions";

export function DeleteConversation({ id, title }: { id: string; title: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      className="btn btn-ghost text-xs text-muted"
      disabled={pending}
      onClick={() => confirm(`Delete "${title}" and its history?`) && start(() => removeConversation(id))}
    >
      Delete
    </button>
  );
}
