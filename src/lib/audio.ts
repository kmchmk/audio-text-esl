import "server-only";

import { spawn } from "node:child_process";

import ffmpegPath from "ffmpeg-static";

/** All audio is processed as mono float32 PCM at this rate. */
export const SAMPLE_RATE = 44100;

function ffmpeg(args: string[], input: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg binary not found"));
    const p = spawn(ffmpegPath, ["-hide_banner", "-loglevel", "error", ...args]);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => err.push(d));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`ffmpeg ${code}: ${Buffer.concat(err)}`)),
    );
    p.stdin.on("error", () => {}); // ffmpeg may close stdin early on bad input; the exit code reports it
    p.stdin.end(input);
  });
}

const toF32 = (b: Buffer) => new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4).slice();
const fromF32 = (a: Float32Array) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
const RAW_IN = ["-f", "f32le", "-ar", String(SAMPLE_RATE), "-ac", "1", "-i", "pipe:0"];
const RAW_OUT = ["-f", "f32le", "-ar", String(SAMPLE_RATE), "-ac", "1", "pipe:1"];

/** Decode any audio file (mp3, wav…) to mono PCM at SAMPLE_RATE. */
export async function decode(file: Buffer): Promise<Float32Array> {
  return toF32(await ffmpeg(["-i", "pipe:0", ...RAW_OUT], file));
}

/** Resample raw mono PCM from another rate. */
export async function resample(pcm: Float32Array, fromRate: number): Promise<Float32Array> {
  if (fromRate === SAMPLE_RATE) return pcm;
  return toF32(await ffmpeg(["-f", "f32le", "-ar", String(fromRate), "-ac", "1", "-i", "pipe:0", ...RAW_OUT], fromF32(pcm)));
}

/** Change tempo without changing pitch. */
export async function changeTempo(pcm: Float32Array, speed: number): Promise<Float32Array> {
  if (Math.abs(speed - 1) < 0.01) return pcm;
  return toF32(await ffmpeg([...RAW_IN, "-filter:a", `atempo=${speed.toFixed(3)}`, ...RAW_OUT], fromF32(pcm)));
}

/** Trim leading/trailing near-silence and peak-normalise so voices from different engines match. */
export function tidy(pcm: Float32Array): Float32Array {
  const thr = 0.01;
  let a = 0;
  let b = pcm.length - 1;
  while (a < b && Math.abs(pcm[a]) < thr) a++;
  while (b > a && Math.abs(pcm[b]) < thr) b--;
  const pad = Math.round(SAMPLE_RATE * 0.04);
  const out = pcm.slice(Math.max(0, a - pad), Math.min(pcm.length, b + pad));
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] = (out[i] / peak) * 0.89; // ≈ -1 dBFS
  return out;
}

/** Encode mono PCM to MP3. */
export async function encodeMp3(pcm: Float32Array): Promise<Buffer> {
  return ffmpeg([...RAW_IN, "-codec:a", "libmp3lame", "-b:a", "96k", "-f", "mp3", "pipe:1"], fromF32(pcm));
}

export const durationMs = (pcm: Float32Array) => Math.round((pcm.length / SAMPLE_RATE) * 1000);

/** Join clips with `pauseMs` of silence between them; returns audio and per-clip [start,end] ms. */
export function stitch(clips: Float32Array[], pauseMs: number) {
  const pause = Math.round((pauseMs / 1000) * SAMPLE_RATE);
  const total = clips.reduce((n, c) => n + c.length, 0) + pause * Math.max(0, clips.length - 1);
  const out = new Float32Array(total);
  const spans: { start_ms: number; end_ms: number }[] = [];
  let o = 0;
  clips.forEach((c, i) => {
    if (i > 0) o += pause;
    spans.push({ start_ms: Math.round((o / SAMPLE_RATE) * 1000), end_ms: Math.round(((o + c.length) / SAMPLE_RATE) * 1000) });
    out.set(c, o);
    o += c.length;
  });
  return { pcm: out, spans };
}
