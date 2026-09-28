import type { SupabaseClient } from "@supabase/supabase-js";
import { CONFIG } from "@/lib/config";
import {
  getLifeThreads,
  getOpenLoops,
  getOrCreateConversation,
  getRecentMessages,
} from "@/lib/db/queries";
import { currentDevelopment, effectiveStatus } from "@/lib/persona/life";
import { stageForFamiliarity } from "@/lib/persona/profile";
import { getOrCreateState } from "@/lib/state/conversation";
import type { LifeThreadRow, OpenLoopRow } from "@/lib/types";
import type { ChatModel } from "./provider";
import { buildOpeningPrompt } from "./prompts";
import { openingSchema } from "./schemas";

/**
 * Opening engine — her initiating when the user returns.
 * Every opener has a reason; she never pings purely for engagement.
 */

export type OpeningStrategy =
  | "event_followup"
  | "memory_followup"
  | "callback"
  | "her_life"
  | "playful"
  | "curiosity"
  | "normal";

export interface OpeningResult {
  strategy: OpeningStrategy;
  reason: string;
  bubbles: string[];
}

export async function generateOpening(opts: {
  supabase: SupabaseClient;
  model: ChatModel;
  userId: string;
}): Promise<OpeningResult | null> {
  const { supabase, model, userId } = opts;

  const [state, conversation] = await Promise.all([
    getOrCreateState(supabase, userId),
    getOrCreateConversation(supabase, userId),
  ]);

  // Never open on first visit — onboarding handles that.
  const recent = await getRecentMessages(supabase, conversation.id, 10);
  if (!recent.length) return null;

  const lastMsg = recent[recent.length - 1];
  const hoursSince =
    (Date.now() - new Date(lastMsg.created_at).getTime()) / 3_600_000;

  // Already has an unread assistant opener? Don't double-open.
  if (lastMsg.role === "assistant" && hoursSince < 24) return null;

  // Too soon to act like she noticed they were gone.
  if (hoursSince < CONFIG.opening.minAbsenceHours) return null;

  const stage = stageForFamiliarity(state.familiarity);
  const tier = { new: 1, warming: 2, familiar: 2, close: 3 }[stage];
  const loops = await getOpenLoops(supabase, userId);
  const threads = await getLifeThreads(supabase, tier);

  // ── Strategy selection ──────────────────────────────────────────────────────
  const now = Date.now();
  const cooldown = CONFIG.opening.nudgeCooldownHours * 3_600_000;
  const candidates: { strategy: OpeningStrategy; reason: string; score: number; loop?: OpenLoopRow; thread?: LifeThreadRow }[] = [];

  for (const l of loops.filter((l) => l.status === "active")) {
    if (l.last_nudged_at && now - new Date(l.last_nudged_at).getTime() < cooldown)
      continue;
    const due = l.due_hint ? new Date(l.due_hint).getTime() - now : Infinity;
    const isDue = due < 24 * 3_600_000; // lands today-ish or just passed
    candidates.push({
      strategy: isDue ? "event_followup" : "memory_followup",
      reason: `open loop: ${l.description}`,
      score: l.importance * l.emotional_weight + (isDue ? 20 : 0),
      loop: l,
    });
  }

  const liveThread = threads
    .filter((t) => t.can_open && effectiveStatus(t) === "active" && currentDevelopment(t))
    .map((t) => ({ t, dev: currentDevelopment(t)! }))
    .at(0);
  if (liveThread) {
    candidates.push({
      strategy: "her_life",
      reason: `her thread: ${liveThread.t.title}`,
      score: 30,
      thread: liveThread.t,
    });
  }

  if (state.summary && hoursSince < 72 && state.recent_emotion) {
    candidates.push({
      strategy: "callback",
      reason: "emotional conversation ended recently",
      score: 40,
    });
  }

  if (hoursSince > 48) {
    candidates.push({ strategy: "playful", reason: "long absence", score: 20 });
  }

  candidates.sort((a, b) => b.score - a.score);
  const chosen =
    candidates.find((c) => c.score >= 25) ??
    (Math.random() < 0.15
      ? { strategy: "curiosity" as const, reason: "wildcard", score: 5 }
      : { strategy: "normal" as const, reason: "no specific reason", score: 0 });

  // ── Generate ────────────────────────────────────────────────────────────────
  const prompt = buildOpeningPrompt({
    strategy: chosen.strategy,
    stage,
    summary: state.summary,
    loop: chosen.loop,
    thread: chosen.thread
      ? { title: chosen.thread.title, development: currentDevelopment(chosen.thread)! }
      : undefined,
  });

  const out = await model.generateStructured({
    schema: openingSchema,
    temperature: 0.9,
    messages: [{ role: "system", content: prompt }],
  });

  // Mark the loop as nudged so we don't re-poke about it.
  if (chosen.loop) {
    await supabase
      .from("open_loops")
      .update({ last_nudged_at: new Date().toISOString() })
      .eq("id", chosen.loop.id);
  }

  return {
    strategy: chosen.strategy,
    reason: chosen.reason,
    bubbles: out.bubbles.slice(0, 3),
  };
}
