import type { SupabaseClient } from "@supabase/supabase-js";
import { CONFIG } from "@/lib/config";
import { stageForFamiliarity } from "@/lib/persona/profile";
import type { Act, Beat, ConversationStateRow } from "@/lib/types";

/**
 * Conversation state — behavioural register + relationship arc.
 * All values are DERIVED from conversation context, never randomized,
 * and never surfaced to the user as literal AI feelings.
 */

export const DEFAULT_STATE = (
  userId: string
): Omit<ConversationStateRow, "updated_at"> => ({
  user_id: userId,
  mood: "neutral",
  energy: CONFIG.mood.baseline.energy,
  warmth: 0.6,
  curiosity: 0.7,
  seriousness: 0.4,
  her_mood: "neutral",
  her_energy: CONFIG.mood.baseline.energy,
  current_beat: "free_chat",
  beat_started_at: null,
  current_topic: null,
  summary: "",
  consecutive_ai_questions: 0,
  act_histogram: {},
  recent_emotion: null,
  familiarity: 0,
  stage: "new",
  days_active: 0,
  active_dates: [],
  depth_points: 0,
  last_depth_date: null,
  first_met_at: new Date().toISOString(),
  last_interaction_at: null,
  last_milestone_day: 0,
  turn_locked_at: null,
});

export async function getOrCreateState(
  supabase: SupabaseClient,
  userId: string
): Promise<ConversationStateRow> {
  const { data } = await supabase
    .from("conversation_state")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return data as ConversationStateRow;

  const row = { ...DEFAULT_STATE(userId), updated_at: new Date().toISOString() };
  await supabase.from("conversation_state").insert(row);
  return row as ConversationStateRow;
}

/**
 * Familiarity accrual — trust is earned over DAYS, not message count.
 * A user cannot binge their way to intimacy in one night.
 */
export function computeFamiliarity(
  state: ConversationStateRow,
  opts: { meaningfulExchange?: boolean } = {}
): {
  familiarity: number;
  stage: ConversationStateRow["stage"];
  daysActive: number;
  activeDates: string[];
  depthPoints: number;
  lastDepthDate: string | null;
} {
  const today = new Date().toISOString().slice(0, 10);
  const dates = new Set(state.active_dates ?? []);
  dates.add(today);

  const activeDates = [...dates].slice(-60);
  const daysActive = dates.size;

  // Depth: meaningful exchanges accrue slowly — once per day max.
  let depthPoints = state.depth_points ?? 0;
  let lastDepthDate = state.last_depth_date;
  if (opts.meaningfulExchange && lastDepthDate !== today) {
    depthPoints = Math.min(depthPoints + 2, 40); // depth alone caps at 40
    lastDepthDate = today;
  }

  // Showing up matters most; days alone can never reach "close".
  const familiarity = Math.min(
    Math.round(
      Math.min(daysActive * CONFIG.familiarity.perDistinctDay, 60) + depthPoints
    ),
    100
  );

  return {
    familiarity,
    stage: stageForFamiliarity(familiarity),
    daysActive,
    activeDates,
    depthPoints,
    lastDepthDate,
  };
}

/** Rolling histogram of assistant acts — feeds the reciprocity rule. */
export function pushActs(
  histogram: Record<string, number>,
  acts: Act[]
): Record<string, number> {
  const next = { ...histogram };
  for (const a of acts) next[a] = (next[a] ?? 0) + 1;
  return next;
}

/** Mood decays toward baseline each turn — momentum, not reset. */
export function decayed(value: number, baseline: number): number {
  const d = CONFIG.mood.decayPerTurn;
  return value + (baseline - value) * d;
}

const VALID_TRANSITIONS: Record<Beat, Beat[]> = {
  free_chat: ["free_chat", "problem_introduced"],
  problem_introduced: ["problem_introduced", "exploring", "free_chat"],
  exploring: ["exploring", "deeper_context", "free_chat", "open_loop_created"],
  deeper_context: ["deeper_context", "reflection", "exploring", "free_chat"],
  reflection: ["reflection", "decision", "exploring", "free_chat"],
  decision: ["decision", "action", "reflection", "free_chat"],
  action: ["action", "open_loop_created", "free_chat"],
  open_loop_created: ["open_loop_created", "free_chat"],
};

/**
 * The model proposes a beat transition; the orchestrator validates.
 * Can't jump problem_introduced → action without exploration —
 * unless the user explicitly asked for advice (handled by caller).
 */
export function validBeatTransition(from: Beat, to: Beat): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export async function applyStateUpdate(
  supabase: SupabaseClient,
  userId: string,
  patch: Partial<ConversationStateRow>
): Promise<void> {
  await supabase
    .from("conversation_state")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
}

/**
 * Per-user turn lock — a conditional UPDATE acts as an atomic
 * compare-and-set over HTTP (PG advisory locks can't span pooled
 * PostgREST requests). A stale lock expires after TTL so a crashed
 * turn can't wedge the account; callers wait briefly so rapid
 * double-texts serialize instead of racing.
 */
export async function acquireTurnLock(
  supabase: SupabaseClient,
  userId: string,
  opts: { ttlMs?: number; waitMs?: number } = {}
): Promise<boolean> {
  // TTL must outlast a worst-case bounded turn: reply gen (timeout × retries)
  // + async extraction rides under the lock too.
  const ttlMs = opts.ttlMs ?? 150_000;
  const deadline = Date.now() + (opts.waitMs ?? 12_000);
  for (;;) {
    const cutoff = new Date(Date.now() - ttlMs).toISOString();
    const { data, error } = await supabase
      .from("conversation_state")
      .update({ turn_locked_at: new Date().toISOString() })
      .eq("user_id", userId)
      .or(`turn_locked_at.is.null,turn_locked_at.lt.${cutoff}`)
      .select("user_id");
    if (error) {
      // Column missing (migration not applied) — don't stall every turn
      // retrying an impossible query; proceed unlocked.
      console.error("[turn-lock] unavailable:", error.message);
      return false;
    }
    if (data?.length) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, 400));
  }
}

export async function releaseTurnLock(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  await supabase
    .from("conversation_state")
    .update({ turn_locked_at: null })
    .eq("user_id", userId);
}
