"use client";

/**
 * Background noise made in the browser with Web Audio, so it's adjustable and never baked
 * into the downloadable MP3.
 */
export const NOISES = [
  { id: "none", label: "No background noise" },
  { id: "cafe", label: "Café murmur" },
  { id: "street", label: "Street traffic" },
  { id: "rain", label: "Rain" },
  { id: "static", label: "Radio static" },
] as const;

export type NoiseId = (typeof NOISES)[number]["id"];

function buffer(ctx: AudioContext, seconds: number, color: "white" | "pink" | "brown") {
  const b = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    if (color === "white") d[i] = w * 0.5;
    else if (color === "brown") {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else {
      // Paul Kellet's pink noise filter
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  }
  return b;
}

export class NoisePlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private nodes: AudioNode[] = [];
  private kind: NoiseId = "none";
  private volume = 0.3;

  setVolume(v: number) {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  setKind(kind: NoiseId, playing: boolean) {
    this.kind = kind;
    this.stop();
    if (playing) this.start();
  }

  start() {
    if (this.kind === "none") return;
    this.ctx ??= new AudioContext();
    void this.ctx.resume();
    const ctx = this.ctx;
    this.stop();
    const master = ctx.createGain();
    master.gain.value = this.volume;
    master.connect(ctx.destination);
    this.master = master;
    const src = (color: "white" | "pink" | "brown") => {
      const s = ctx.createBufferSource();
      s.buffer = buffer(ctx, 6, color);
      s.loop = true;
      s.start();
      this.nodes.push(s);
      return s;
    };
    const filter = (type: BiquadFilterType, f: number, q = 0.7) => {
      const n = ctx.createBiquadFilter();
      n.type = type;
      n.frequency.value = f;
      n.Q.value = q;
      this.nodes.push(n);
      return n;
    };
    const lfo = (target: AudioParam, rate: number, depth: number) => {
      const o = ctx.createOscillator();
      o.frequency.value = rate;
      const g = ctx.createGain();
      g.gain.value = depth;
      o.connect(g).connect(target);
      o.start();
      this.nodes.push(o, g);
    };
    if (this.kind === "cafe") {
      // Several speech-band noise "voices", each fluttering at syllable rates, sound like chatter.
      for (const [f, r] of [[450, 3.7], [900, 4.9], [1500, 5.6], [700, 4.3]] as const) {
        const g = ctx.createGain();
        g.gain.value = 0.35;
        lfo(g.gain, r, 0.3);
        src("pink").connect(filter("bandpass", f, 1.2)).connect(g).connect(master);
        this.nodes.push(g);
      }
    } else if (this.kind === "street") {
      const g = ctx.createGain();
      g.gain.value = 0.8;
      lfo(g.gain, 0.08, 0.35);
      src("brown").connect(filter("lowpass", 500)).connect(g).connect(master);
      this.nodes.push(g);
    } else if (this.kind === "rain") {
      src("pink").connect(filter("highpass", 900)).connect(filter("lowpass", 9000)).connect(master);
    } else if (this.kind === "static") {
      const g = ctx.createGain();
      g.gain.value = 0.25;
      src("white").connect(filter("bandpass", 2500, 0.5)).connect(g).connect(master);
      this.nodes.push(g);
    }
  }

  stop() {
    for (const n of this.nodes) {
      try {
        if (n instanceof AudioScheduledSourceNode) n.stop();
        n.disconnect();
      } catch {}
    }
    this.nodes = [];
    this.master?.disconnect();
    this.master = null;
  }

  dispose() {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
  }
}
