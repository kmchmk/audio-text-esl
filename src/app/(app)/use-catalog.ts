"use client";

import { useEffect, useState } from "react";

export type VoiceOption = { id: string; label: string; gender: string; accent: string };
export type ModelOption = {
  provider: "supertonic" | "openrouter";
  model: string;
  name: string;
  est_template_usd: number;
  price_note: string;
  emotion: "none" | "azure_style" | "instructions" | "bracket_tag";
  native_speed: boolean;
  free: boolean;
  voices: VoiceOption[];
};
export type Catalog = { models: ModelOption[]; rate: number; maxTemplateUsd: number };

let shared: Promise<Catalog> | undefined;

/** Voice catalog, fetched once per page load. */
export function useCatalog() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  useEffect(() => {
    shared ??= fetch("/api/catalog").then((r) => {
      if (!r.ok) throw new Error("catalog");
      return r.json();
    });
    shared.then(setCatalog).catch(() => (shared = undefined));
  }, []);
  return catalog;
}

export const findModel = (c: Catalog | null, provider: string, model: string) =>
  c?.models.find((m) => m.provider === provider && m.model === model);
