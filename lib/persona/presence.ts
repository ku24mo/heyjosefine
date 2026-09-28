import type { SupabaseClient } from "@supabase/supabase-js";
import { herNow } from "@/lib/time";
import type { MessageRow } from "@/lib/types";

/**
 * Presence economy — she is not always on.
 *
 * Sleep is a decision, not a schedule. Three states:
 *   here   → fully present
 *   fading → up but winding down / groggy — the model sees "it's late" and
 *            may announce bed (or keep talking if the convo earns it)
 *   out    → silence. Messages queue; she picks them up when she's back.
 *
 * `out` happens only when it's real: she said goodnight, or it's deep night
 * and the conversation isn't carrying her. A brand-new user never gets
 * silence — she's just up late tonight.
 */

export type PresenceState = "here" | "fading" | "out";

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
  /** any prior conversation at all — a brand-new user never gets silence */
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

  let state: PresenceState;
  if (h >= 2 && h < 7) {
    state = "out"; // deep night — near-absolute
  } else if (h >= 1 && h < 2) {
    // the small-hours edge: only a night-owl night or a live convo keeps her up
    state = vibe.staysUpLate || opts.convoActive ? "fading" : "out";
  } else if (h >= 22 || h < 1) {
    state = "fading"; // winding-down window
  } else if (h >= 7 && h < 9) {
    state = "fading"; // early — groggy
  } else {
    state = "here";
  }

  // A declared goodnight is binding until morning.
  if (opts.saidGoodnight && (h >= 21 || h < 9)) state = "out";

  // A new user always gets a conversation — she's just up late tonight.
  if (!opts.hasHistory && state === "out") state = "fading";

  const promptLine =
    state === "fading"
      ? h >= 21 || h < 2
        ? `It's ${n.time} in Stockholm — properly late for her. Lower energy is fair, and "you have me staying up past my bedtime" is earned, not needy. If she says she's heading to bed she means it — she will go quiet after.`
        : `It's ${n.time} — early morning for her. She may be groggy, half-awake, grabbing coffee.`
      : null;

  return { state, vibe, promptLine };
}

/**
 * Read-side presence for API routes (header status, opening guard).
 * Same inputs as the orchestrator computes, minus generation.
 */
export async function currentPresence(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date()
): Promise<PresenceInfo> {
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
  const goodnight =
    lastAssistant != null &&
    /night|good ?night|sleep|bed|crash|😴|💤|gn\b|natt/i.test(lastAssistant.content) &&
    now.getTime() - new Date(lastAssistant.created_at).getTime() < 8 * 3_600_000;
  const convoActive =
    lastUser != null &&
    now.getTime() - new Date(lastUser.created_at).getTime() < 20 * 60_000;

  return herPresence({
    userId,
    hasHistory: recent.length > 0,
    saidGoodnight: goodnight,
    convoActive,
    now,
  });
}
