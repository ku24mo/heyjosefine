"use client";

/**
 * Tiny synthesized message sounds — no assets. AudioContext unlocks on the
 * first user gesture (the send), so calls before that are no-ops anyway.
 */

let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  try {
    ctx ??= new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** iOS-esque send whoosh — quick rising sweep, ~140ms. */
export function sendSound() {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  const osc = a.createOscillator();
  const gain = a.createGain();
  const filter = a.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(1400, t);
  osc.type = "sine";
  osc.frequency.setValueAtTime(500, t);
  osc.frequency.exponentialRampToValueAtTime(1200, t + 0.12);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
  osc.connect(filter).connect(gain).connect(a.destination);
  osc.start(t);
  osc.stop(t + 0.16);
}

/** Incoming bubble — soft pop, ~90ms. */
export function receiveSound() {
  const a = ac();
  if (!a) return;
  const t = a.currentTime;
  const osc = a.createOscillator();
  const gain = a.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(760, t);
  osc.frequency.exponentialRampToValueAtTime(540, t + 0.07);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.06, t + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
  osc.connect(gain).connect(a.destination);
  osc.start(t);
  osc.stop(t + 0.11);
}
