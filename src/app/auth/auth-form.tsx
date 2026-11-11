"use client";

import Link from "next/link";
import { useActionState, type ReactNode } from "react";

import type { FormState } from "./actions";

type Field = { name: string; label: string; type?: string; autoComplete?: string; hidden?: string };

export function AuthForm({
  title,
  action,
  fields,
  submit,
  footer,
  notice,
}: {
  title: string;
  action: (s: FormState, f: FormData) => Promise<FormState>;
  fields: Field[];
  submit: string;
  footer?: ReactNode;
  notice?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form action={formAction} className="card w-full max-w-sm space-y-4 p-6">
        <div>
          <p className="text-sm text-muted">ESL Listening Studio</p>
          <h1 className="text-xl font-semibold">{title}</h1>
        </div>
        {notice && <p className="rounded-md bg-accent-soft px-3 py-2 text-sm">{notice}</p>}
        {fields.map((f) =>
          f.hidden !== undefined ? (
            <input key={f.name} type="hidden" name={f.name} value={f.hidden} />
          ) : (
            <label key={f.name} className="block space-y-1">
              <span className="text-sm font-medium">{f.label}</span>
              <input
                name={f.name}
                type={f.type ?? "text"}
                autoComplete={f.autoComplete}
                required
                className="input w-full"
              />
            </label>
          ),
        )}
        {state?.error && <p className="text-sm text-danger">{state.error}</p>}
        {state?.message && <p className="text-sm">{state.message}</p>}
        <button type="submit" disabled={pending} className="btn btn-primary w-full">
          {pending ? "Please wait…" : submit}
        </button>
        {footer && <div className="space-y-1 text-center text-sm text-muted">{footer}</div>}
      </form>
    </main>
  );
}

export function A({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="underline underline-offset-2 hover:text-fg">
      {children}
    </Link>
  );
}
