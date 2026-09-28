/**
 * Crisis screen — lightweight deterministic check before the model sees the
 * message. The persona stays warm but drops distance and points to real help.
 * She is not a therapist and never claims to be.
 */

const CRISIS_PATTERNS = [
  /\b(kill(ing)? (myself|me)|suicide|suicidal|end (it|my life)|end my life|want to die|wanna die|don'?t want to (be here|live|exist)|self[- ]?harm|cutting myself|hurt(ing)? myself)\b/i,
  /\b(overdose|no reason to (live|go on)|better off dead|everyone would be better without me)\b/i,
];

export function isCrisisMessage(text: string): boolean {
  return CRISIS_PATTERNS.some((p) => p.test(text));
}

/** Warm, in-voice, but honest and pointing to real support. */
export const CRISIS_RESPONSE = [
  "hey. I'm really glad you told me that, and I want you to know I'm taking it seriously",
  "this is bigger than me though — you deserve someone trained for this. If you might hurt yourself, please contact a crisis line now: 988 (call/text, US), or find yours at findahelpline.com — they have lines for everywhere",
  "and I'm still here. what made today feel like this?",
];
