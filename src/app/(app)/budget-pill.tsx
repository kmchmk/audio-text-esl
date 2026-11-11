"use client";

import { useEffect, useState } from "react";

import { formatThb } from "@/lib/money";

type BudgetResponse = {
  rate: number;
  budget: { keyLimit: number | null; keyUsed: number; remaining: number | null } | null;
};

/** Shared OpenRouter balance in Thai baht. Refreshes every minute and after each generation. */
export function BudgetPill() {
  const [b, setB] = useState<BudgetResponse | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/budget", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => alive && j && setB(j))
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    window.addEventListener("budget:refresh", load);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("budget:refresh", load);
    };
  }, []);
  if (!b?.budget || b.budget.remaining == null) return null;
  const { remaining, keyLimit } = b.budget;
  return (
    <span
      className="chip"
      data-tour="budget"
      title={`Shared budget for paid voices. Free voices cost nothing. ${keyLimit != null ? `Cap: ${formatThb(keyLimit, b.rate)}.` : ""} Rate: ฿${b.rate}/USD.`}
    >
      Budget left: {formatThb(remaining, b.rate)}
    </span>
  );
}
