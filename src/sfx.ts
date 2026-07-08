// Tiny WebAudio synth for game feedback. No assets required.

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, when = 0): void {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + when;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.6), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const sfx = {
  launch(): void {
    tone(220, 0.12, 'triangle', 0.15);
  },
  bump(intensity: number): void {
    tone(120 + intensity * 60, 0.06, 'sine', Math.min(0.12, 0.04 + intensity * 0.05));
  },
  /** Rising pop — pitch scales with the tier created. */
  merge(tier: number): void {
    const base = 330 * Math.pow(1.12, tier);
    tone(base, 0.14, 'sine', 0.2);
    tone(base * 1.5, 0.18, 'sine', 0.14, 0.06);
  },
  order(): void {
    tone(523, 0.12, 'triangle', 0.18);
    tone(659, 0.12, 'triangle', 0.18, 0.1);
    tone(784, 0.2, 'triangle', 0.18, 0.2);
  },
  gameOver(): void {
    tone(392, 0.2, 'sawtooth', 0.1);
    tone(311, 0.25, 'sawtooth', 0.1, 0.18);
    tone(233, 0.4, 'sawtooth', 0.1, 0.38);
  },
};
