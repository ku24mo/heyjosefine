import type { SupabaseClient } from "@supabase/supabase-js";
import { herNow } from "@/lib/time";
import type { MessageRow } from "@/lib/types";

/**
 * Presence economy — she is not always *equally* on.
 *
 * Two states:
 *   here → fully present
 *   away → her night hours (or right after a goodnight). She still answers —
 *          just slower, shorter, less enthusiastic, and she lets the hour
 *          show: hints that she should crash. Never silence; a real person
 *          winding down, not a wall.
 */

export type PresenceState = "here" | "away";

/** Her declaring sleep — "night 😴", "gn", "I'm gonna crash". Presence-domain
 *  truth: once this lands, the post-goodnight arc owns the rest of the night. */
export const GOODNIGHT =
  /\b(night|good ?night|sleep|bed|crash|gn|natt)\b|😴|💤/i;

export interface DayVibe {
  /** day-level tone — blended into her_mood */
  mood: "bright" | "flat" | "tired" | "chaotic" | "neutral";
  /** decay baseline for her_energy today */
  energy: number;
  /** night-owl night — she stays up past her usual window */
  staysUpLate: boolean;
}

export interface PresenceInfo {
  state: PresenceState;
  vibe: DayVibe;
  /** prompt-facing note injected as a directive when state !== "here" */
  promptLine: string | null;
}

// Deterministic hash — same user + same Stockholm date ⇒ same vibe all day.
function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * The day-seeded layer of her unpredictability. Every day starts slightly
 * different — bright, flat, tired, chaotic — and ~1 night in 4 she's just
 * up late for no particular reason. Coherent variance, not a slot machine.
 */
export function dailyVibe(userId: string, now: Date = new Date()): DayVibe {
  const { date } = herNow(now);
  const seed = hash32(`${userId}#${date}`);
  const roll = seed % 100;
  const mood =
    roll < 18 ? "bright"
    : roll < 38 ? "flat"
    : roll < 53 ? "tired"
    : roll < 63 ? "chaotic"
    : "neutral";
  const energy =
    { bright: 0.85, flat: 0.5, tired: 0.45, chaotic: 0.75, neutral: 0.65 }[mood];
  const staysUpLate = Math.floor(seed / 101) % 100 < 25;
  return { mood, energy, staysUpLate };
}

export function herPresence(opts: {
  userId: string;
  /** any prior conversation at all */
  hasHistory: boolean;
  /** her last message announced sleep recently ("night 😴") */
  saidGoodnight: boolean;
  /** the conversation is actively flowing right now */
  convoActive: boolean;
  now?: Date;
}): PresenceInfo {
  const now = opts.now ?? new Date();
  const n = herNow(now);
  const vibe = dailyVibe(opts.userId, now);
  const h = n.hour;

  const night = h >= 22 || h < 9;
  let state: PresenceState = night ? "away" : "here";

  // A declared goodnight keeps her "away" until morning even if she keeps
  // half-answering — she said night, the status should match.
  if (opts.saidGoodnight && night) state = "away";

  const deepNight = h >= 1 && h < 7;
  const lateEvening = h >= 22 || h < 1;

  // Post-goodnight: she said night, he's still texting, so she's still
  // answering — half-asleep with the phone on her chest. The exit already
  // happened; re-announcing it every turn is what read as scripted.
  const postGoodnight =
    state === "away" && night && opts.saidGoodnight;

  const promptLine =
    state === "away"
      ? postGoodnight
        ? `It's ${n.time} in Stockholm — she said goodnight already and he's still texting, so she's still answering, half-asleep. Replies are SHORT: one line, sometimes one word or just an emoji. Do NOT re-announce leaving or say goodnight again — that moment passed. An occasional sleepy tease is right ("ugh I'm literally falling asleep 😭", "you're not letting me sleep lol"), but she stays.`
        : deepNight
        ? vibe.staysUpLate
          ? `It's ${n.time} in Stockholm — the middle of the night, and she's still up. Restless-night energy: quiet, unhurried, a little more honest than daytime. She can still hint at bed, but tonight she's in no rush.`
          : `It's ${n.time} in Stockholm — deep night, she's half-asleep. Replies stay short and dry, a little slower. She'll hint she should crash ("it's ${h}am and I have an 8am", "okay I'm actually falling asleep 😭") — but she keeps answering if he keeps talking.`
        : lateEvening
          ? `It's ${n.time} in Stockholm — late for her. Winding-down energy: still warm but softer, and it's natural to mention the hour ("it's nearly midnight here", "you have me staying up"). If she says she's heading to bed, she means it — expect her replies to get sleepy.`
          : `It's ${n.time} — early morning for her. Groggy, half-awake, grabbing coffee energy.`
      : null;

  return { state, vibe, promptLine };
}

/**
 * Dead-night guard for proactive texts — she doesn't *start* conversations
 * at 3am, but 7:30am "morning ☕️" is completely plausible.
 */
export function canInitiate(now: Date = new Date()): boolean {
  const h = herNow(now).hour;
  return h >= 7 && h < 23;
}

/**
 * Read-side presence for API routes (header status, opening guard).
 * Same inputs as the orchestrator computes, minus generation — plus
 * `lastSeenAt`, the timestamp of her most recent message.
 */
export async function currentPresence(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date()
): Promise<PresenceInfo & { lastSeenAt: string | null }> {
  const { data: convo } = await supabase
    .from("conversations")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let recent: Pick<MessageRow, "role" | "content" | "created_at">[] = [];
  if (convo) {
    const { data } = await supabase
      .from("messages")
      .select("role,content,created_at")
      .eq("conversation_id", convo.id)
      .order("created_at", { ascending: false })
      .limit(30);
    recent = ((data ?? []) as typeof recent).reverse();
  }

  const lastAssistant = [...recent].reverse().find((m) => m.role === "assistant");
  const lastUser = [...recent].reverse().find((m) => m.role === "user");
  // Scan her last few messages — a post-goodnight "ugh stop 😭" without a
  // night keyword must not flip the flag back off and re-trigger hint mode.
  const goodnight = recent
    .filter((m) => m.role === "assistant")
    .slice(-5)
    .some(
      (m) =>
        GOODNIGHT.test(m.content) &&
        now.getTime() - new Date(m.created_at).getTime() < 8 * 3_600_000
    );
  const convoActive =
    lastUser != null &&
    now.getTime() - new Date(lastUser.created_at).getTime() < 20 * 60_000;

  return {
    ...herPresence({
      userId,
      hasHistory: recent.length > 0,
      saidGoodnight: goodnight,
      convoActive,
      now,
    }),
    lastSeenAt: lastAssistant?.created_at ?? null,
  };
}
