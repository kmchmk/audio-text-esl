"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import type { CharacterView } from "@/lib/data";
import { formatThb } from "@/lib/money";

import { removeCharacter, saveCharacter } from "../actions";
import { findModel, useCatalog, type Catalog } from "../use-catalog";

const GENDERS = ["female", "male", "neutral"];
const AGES = [
  ["child", "Child"],
  ["teen", "Teen"],
  ["young_adult", "Young adult"],
  ["adult", "Adult"],
  ["senior", "Senior"],
];
const ACCENTS = ["American", "British", "Australian", "Indian", "Irish", "Canadian", "New Zealand", "South African", "Singaporean", "Filipino", "Not specified"];

type Draft = Omit<CharacterView, "id" | "version_id" | "version">;

const blank: Draft = {
  name: "",
  gender: "female",
  age_group: "adult",
  accent: "American",
  provider: "supertonic",
  model: "supertonic-3",
  voice: "F1",
  default_speed: 1,
};

export function CharacterList({ initial }: { initial: CharacterView[] }) {
  const catalog = useCatalog();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const router = useRouter();
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {initial.map((c) =>
          editing === c.id ? (
            <CharacterForm
              key={c.id}
              id={c.id}
              initial={c}
              catalog={catalog}
              onDone={() => {
                setEditing(null);
                router.refresh();
              }}
            />
          ) : (
            <div key={c.id} className="card flex items-start gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {c.name} <span className="chip ml-1">v{c.version}</span>
                </p>
                <p className="text-sm text-muted">
                  {c.gender} · {AGES.find((a) => a[0] === c.age_group)?.[1] ?? c.age_group} · {c.accent} · speed {c.default_speed}×
                </p>
                <p className="truncate text-xs text-muted">
                  {findModel(catalog, c.provider, c.model)?.name ?? c.model} · {c.voice}
                </p>
              </div>
              <button className="btn" onClick={() => setEditing(c.id)}>
                Edit
              </button>
            </div>
          ),
        )}
        {editing === "new" && (
          <CharacterForm
            id={null}
            initial={blank}
            catalog={catalog}
            onDone={() => {
              setEditing(null);
              router.refresh();
            }}
          />
        )}
      </div>
      {editing !== "new" && (
        <button className="btn btn-primary" onClick={() => setEditing("new")}>
          Add character
        </button>
      )}
    </div>
  );
}

function CharacterForm({
  id,
  initial,
  catalog,
  onDone,
}: {
  id: string | null;
  initial: Draft;
  catalog: Catalog | null;
  onDone: () => void;
}) {
  const [d, setD] = useState<Draft>({ ...initial });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const model = findModel(catalog, d.provider, d.model);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  function pickModel(key: string) {
    const [provider, ...rest] = key.split("|");
    const m = findModel(catalog, provider, rest.join("|"));
    if (!m) return;
    const v = m.voices[0];
    setD((x) => ({ ...x, provider: m.provider, model: m.model, voice: v.id, ...describe(v) }));
  }
  function pickVoice(id: string) {
    const v = model?.voices.find((x) => x.id === id);
    if (v) setD((x) => ({ ...x, voice: v.id, ...describe(v) }));
  }

  return (
    <div className="card space-y-3 p-4 sm:col-span-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input className="input w-full" value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Grandpa" />
        </Field>
        <Field label="Voice service">
          <select className="input w-full" value={`${d.provider}|${d.model}`} onChange={(e) => pickModel(e.target.value)} disabled={!catalog}>
            {!catalog && <option>Loading voices…</option>}
            {catalog && (
              <>
                <optgroup label="Free">
                  {catalog.models.filter((m) => m.free).map((m) => (
                    <option key={m.model} value={`${m.provider}|${m.model}`}>
                      {m.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Paid (cost of a 16-line conversation)">
                  {catalog.models.filter((m) => !m.free).map((m) => (
                    <option key={m.model} value={`${m.provider}|${m.model}`}>
                      {m.name} · ~{formatThb(m.est_template_usd, catalog.rate)}
                      {m.emotion !== "none" ? " · emotions" : ""}
                    </option>
                  ))}
                </optgroup>
              </>
            )}
          </select>
        </Field>
        <Field label="Voice">
          <div className="flex gap-2">
            <select className="input min-w-0 flex-1" value={d.voice} onChange={(e) => pickVoice(e.target.value)}>
              {(model?.voices ?? [{ id: d.voice, label: d.voice, gender: "", accent: "" }]).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                  {v.gender !== "unknown" && v.gender ? ` · ${v.gender}` : ""}
                  {v.accent && v.accent !== "Not specified" ? ` · ${v.accent}` : ""}
                </option>
              ))}
            </select>
            <Preview provider={d.provider} model={d.model} voice={d.voice} speed={d.default_speed} rate={catalog?.rate ?? 0} />
          </div>
        </Field>
        <Field label={`Default speed: ${d.default_speed.toFixed(2)}×`}>
          <input type="range" min={0.6} max={1.6} step={0.05} className="w-full" value={d.default_speed} onChange={(e) => set("default_speed", Number(e.target.value))} />
        </Field>
        <Field label="Gender">
          <select className="input w-full" value={d.gender} onChange={(e) => set("gender", e.target.value)}>
            {GENDERS.map((g) => (
              <option key={g}>{g}</option>
            ))}
          </select>
        </Field>
        <Field label="Age">
          <select className="input w-full" value={d.age_group} onChange={(e) => set("age_group", e.target.value)}>
            {AGES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Accent">
          <select className="input w-full" value={d.accent} onChange={(e) => set("accent", e.target.value)}>
            {[...new Set([d.accent, ...ACCENTS])].map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </Field>
      </div>
      {model && (
        <p className="text-xs text-muted">
          {model.price_note}. {model.emotion === "none" ? "This voice ignores emotions (speed still works)." : "This voice can show emotions."}{" "}
          Gender, age and accent are labels for you; the voice decides how it actually sounds.
        </p>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          className="btn btn-primary"
          disabled={pending || !d.name.trim()}
          onClick={() =>
            start(async () => {
              const r = await saveCharacter(id, { ...d, provider: d.provider as "supertonic" | "openrouter" });
              if (r.ok) onDone();
              else setError(r.error);
            })
          }
        >
          {pending ? "Saving…" : id ? "Save as new version" : "Create character"}
        </button>
        <button className="btn" onClick={onDone}>
          Cancel
        </button>
        {id && (
          <button
            className="btn btn-ghost ml-auto text-danger"
            onClick={() => confirm(`Remove ${initial.name}? Existing audio keeps working.`) && start(async () => (await removeCharacter(id), onDone()))}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function describe(v: { gender: string; accent: string }): Partial<Draft> {
  const out: Partial<Draft> = {};
  if (v.gender === "male" || v.gender === "female") out.gender = v.gender;
  if (v.accent && v.accent !== "Not specified") out.accent = v.accent;
  return out;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}

/** Plays a short sample of a voice. Paid samples are cached, so each costs once. */
export function Preview({ provider, model, voice, speed, rate }: { provider: string; model: string; voice: string; speed: number; rate: number }) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [note, setNote] = useState("");
  const audio = useRef<HTMLAudioElement | null>(null);
  async function play() {
    setState("loading");
    setNote("");
    try {
      const r = await fetch("/api/voice-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model, voice, speed }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Preview failed");
      audio.current?.pause();
      audio.current = new Audio(j.url);
      await audio.current.play();
      if (j.cost_usd > 0) {
        setNote(`cost ${formatThb(j.cost_usd, rate)}`);
        window.dispatchEvent(new Event("budget:refresh"));
      }
      setState("idle");
    } catch (e) {
      setState("error");
      setNote((e as Error).message);
    }
  }
  return (
    <span className="flex items-center gap-2">
      <button type="button" className="btn" onClick={play} disabled={state === "loading"} title="Play a sample">
        {state === "loading" ? "…" : "▶ Preview"}
      </button>
      {note && <span className={`text-xs ${state === "error" ? "text-danger" : "text-muted"}`}>{note}</span>}
    </span>
  );
}
