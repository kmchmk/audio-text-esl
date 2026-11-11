"use client";

import { useEffect, useRef, useState } from "react";

import { NoisePlayer, NOISES, type NoiseId } from "./noise";

export type PlayerLine = { character: string; text: string; start_ms: number | null; end_ms: number | null };

/** Conversation player: transcript follows the audio, click a line to jump, optional background noise. */
export function Player({ src, lines, hideTranscript = false }: { src: string; lines: PlayerLine[]; hideTranscript?: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const noise = useRef<NoisePlayer | null>(null);
  const [now, setNow] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [kind, setKind] = useState<NoiseId>("none");
  const [volume, setVolume] = useState(0.3);
  const [showText, setShowText] = useState(!hideTranscript);

  useEffect(() => {
    noise.current = new NoisePlayer();
    return () => noise.current?.dispose();
  }, []);
  useEffect(() => noise.current?.setKind(kind, playing), [kind, playing]);
  useEffect(() => noise.current?.setVolume(volume), [volume]);

  const ms = now * 1000;
  const active = lines.findIndex((l) => l.start_ms != null && l.end_ms != null && ms >= l.start_ms && ms < l.end_ms + 250);

  return (
    <div className="space-y-3">
      <audio
        ref={audio}
        src={src}
        controls
        preload="metadata"
        className="w-full"
        onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value as NoiseId)} aria-label="Background noise">
          {NOISES.map((n) => (
            <option key={n.id} value={n.id}>
              {n.label}
            </option>
          ))}
        </select>
        {kind !== "none" && (
          <label className="flex items-center gap-2 text-muted">
            Noise level
            <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => setVolume(Number(e.target.value))} />
          </label>
        )}
        {!hideTranscript && (
          <label className="ml-auto flex items-center gap-1.5 text-muted">
            <input type="checkbox" checked={showText} onChange={(e) => setShowText(e.target.checked)} />
            Show transcript
          </label>
        )}
      </div>
      {showText && (
        <ol className="space-y-1">
          {lines.map((l, i) => (
            <li key={i}>
              <button
                className={`w-full rounded-md px-2 py-1 text-left text-sm ${i === active ? "bg-accent-soft" : "hover:bg-bg"}`}
                onClick={() => {
                  if (audio.current && l.start_ms != null) {
                    audio.current.currentTime = l.start_ms / 1000;
                    void audio.current.play();
                  }
                }}
              >
                <span className="font-medium">{l.character}:</span> {l.text}
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
