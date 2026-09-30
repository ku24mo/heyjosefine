import type { SupabaseClient } from "@supabase/supabase-js";
import { CONFIG } from "@/lib/config";
import {
  getLifeThreads,
  getOpenLoops,
  getOrCreateConversation,
  getRecentMessages,
} from "@/lib/db/queries";
import { pickMedia, type PickedMedia } from "@/lib/media/pick";
import { dayLine, getHerDayContext, slotNow, slotToSubjects } from "@/lib/persona/day";
import { currentDevelopment, currentDevelopmentIndex, effectiveStatus } from "@/lib/persona/life";
import { GOODNIGHT } from "@/lib/persona/presence";
import { stageForFamiliarity } from "@/lib/persona/profile";
import { herNow } from "@/lib/time";
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
  | "first_hello"
  | "morning_after"
  | "milestone"
  | "media"
  | "normal";

/** Relationship anniversaries she notices herself. */
export const MILESTONE_DAYS = [7, 14, 30, 60, 90, 180, 365];

/**
 * Highest crossed-but-uncelebrated milestone. Only the biggest one fires —
 * come back after 40 days and she marks the month, not the week too.
 */
export function nextMilestone(
  daysKnown: number,
  lastMilestoneDay: number
): number | null {
  const crossed = MILESTONE_DAYS.filter(
    (d) => d <= daysKnown && d > lastMilestoneDay
  );
  return crossed.length ? crossed[crossed.length - 1] : null;
}

export interface OpeningResult {
  strategy: OpeningStrategy;
  reason: string;
  bubbles: string[];
  /** Photo attached to this opener — the route persists it + the ledger. */
  media: PickedMedia | null;
}

export async function generateOpening(opts: {
  supabase: SupabaseClient;
  model: ChatModel;
  userId: string;
}): Promise<OpeningResult | null> {
  const { supabase, model, userId } = opts;

  const [state, conversation, profile] = await Promise.all([
    getOrCreateState(supabase, userId),
    getOrCreateConversation(supabase, userId),
    supabase.from("profiles").select("created_at").eq("id", userId).maybeSingle(),
  ]);

  // First visit = the product opens itself — a stranger texting him first.
  // Guests land here on their very first mount; this is the magic moment.
  const recent = await getRecentMessages(supabase, conversation.id, 10);
  if (!recent.length) {
    const prompt = buildOpeningPrompt({
      strategy: "first_hello",
      stage: "new",
      summary: "",
    });
    const out = await model.generateStructured({
      schema: openingSchema,
      temperature: 0.9,
      messages: [{ role: "system", content: prompt }],
    });
    return {
      strategy: "first_hello",
      reason: "brand new visitor",
      bubbles: out.bubbles.slice(0, 3),
      media: null,
    };
  }

  const lastMsg = recent[recent.length - 1];
  const hoursSince =
    (Date.now() - new Date(lastMsg.created_at).getTime()) / 3_600_000;

  // Already has an unread assistant opener? Don't double-open. A goodnight
  // is exempt — it's a closer, not a hook awaiting his reply, so "morning
  // after" can legitimately re-open the next day.
  if (
    lastMsg.role === "assistant" &&
    hoursSince < 24 &&
    !GOODNIGHT.test(lastMsg.content)
  )
    return null;

  // Too soon to act like she noticed they were gone.
  if (hoursSince < CONFIG.opening.minAbsenceHours) return null;

  const stage = stageForFamiliarity(state.familiarity);
  const tier = { new: 1, warming: 2, familiar: 2, close: 3 }[stage];
  const loops = await getOpenLoops(supabase, userId);
  const threads = await getLifeThreads(supabase, tier);

  // ── Strategy selection ──────────────────────────────────────────────────────
  const now = Date.now();
  const cooldown = CONFIG.opening.nudgeCooldownHours * 3_600_000;
  const candidates: { strategy: OpeningStrategy; reason: string; score: number; loop?: OpenLoopRow; thread?: LifeThreadRow; milestone?: number; media?: PickedMedia }[] = [];

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

  // He kept her up last night — the payoff of the declared goodnight.
  if (
    lastMsg.role === "assistant" &&
    GOODNIGHT.test(lastMsg.content) &&
    herNow().hour >= 7 &&
    herNow().hour < 12
  ) {
    candidates.push({
      strategy: "morning_after",
      reason: "she declared sleep and he's back",
      score: 50,
    });
  }

  // Anniversary — she notices it herself. profiles.created_at survives both
  // conversation resets and the guest→claim conversion (same user_id).
  const knownSince = profile.data?.created_at ?? state.first_met_at;
  const daysKnown = Math.floor(
    (now - new Date(knownSince).getTime()) / 86_400_000
  );
  const milestone = nextMilestone(daysKnown, state.last_milestone_day ?? 0);
  if (milestone) {
    candidates.push({
      strategy: "milestone",
      reason: `${milestone} days known`,
      score: 60,
      milestone,
    });
  }

  // Her day sheet — shared reality for openers; media prefers subjects that
  // are plausible right now (no gym pic on a day she's home sick).
  const dayCtx = await getHerDayContext(model);
  const currentSlot = dayCtx.day ? slotNow(dayCtx.day.slots) : null;
  const preferSubjects = currentSlot
    ? slotToSubjects(currentSlot.kind)
    : undefined;

  // A photo IS the opener — a timeline asset just unlocked, or she just
  // shares a thing unprompted (what real texting looks like). Never when
  // the last stretch was emotionally heavy — no taco pic during bad news.
  // pickMedia enforces tier/unlock-day/cadence/never-twice itself.
  if (!state.recent_emotion) {
    const mediaPick = await pickMedia(supabase, {
      userId,
      stageTier: tier,
      daysKnown,
      intent: null,
      preferSubjects,
    });
    if (mediaPick) {
      candidates.push({
        strategy: "media",
        reason: `photo: ${mediaPick.asset.subject}`,
        score: 35,
        media: mediaPick,
      });
    }
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
    milestone: chosen.milestone,
    herDayLine: dayLine(dayCtx.day),
    mediaSubject:
      chosen.strategy === "media" ? chosen.media?.asset.subject : undefined,
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

  // A thread used as an opener is a beat he's now heard — record it so the
  // next in-turn mention escalates instead of re-telling.
  if (chosen.thread) {
    const devIdx = currentDevelopmentIndex(chosen.thread);
    await supabase.from("life_thread_state").upsert(
      {
        user_id: userId,
        thread_id: chosen.thread.id,
        last_mentioned_at: new Date().toISOString(),
        ...(devIdx !== null ? { awareness_stage: devIdx } : {}),
      },
      { onConflict: "user_id,thread_id" }
    );
  }

  // Celebrate each milestone exactly once. Fail-soft: a missing column
  // pre-migration just means it may fire again — never a crash.
  if (chosen.milestone) {
    await supabase
      .from("conversation_state")
      .update({ last_milestone_day: chosen.milestone })
      .eq("user_id", userId);
  }

  return {
    strategy: chosen.strategy,
    reason: chosen.reason,
    bubbles: out.bubbles.slice(0, 3),
    media: chosen.strategy === "media" ? chosen.media ?? null : null,
  };
}
