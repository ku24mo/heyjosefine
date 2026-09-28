import type { SupabaseClient } from "@supabase/supabase-js";
import { CONFIG } from "@/lib/config";
import {
  getActiveMemories,
  getLifeThreads,
  getOpenLoops,
  getOrCreateConversation,
  getRecentMessages,
  insertMessage,
} from "@/lib/db/queries";
import { extractAndStore } from "@/lib/memory/extract";
import { HeuristicRetriever } from "@/lib/memory/retrieve";
import { effectiveStatus } from "@/lib/persona/life";
import { herPresence } from "@/lib/persona/presence";
import { stageForFamiliarity, type DisclosureTier } from "@/lib/persona/profile";
import { herNow } from "@/lib/time";
import {
  applyStateUpdate,
  computeFamiliarity,
  decayed,
  getOrCreateState,
  pushActs,
  validBeatTransition,
} from "@/lib/state/conversation";
import type {
  AssistantResponse,
  Beat,
  ConversationStateRow,
  MessageRow,
} from "@/lib/types";
import { composeIntention } from "./intention";
import type { ChatModel, ChatMessage } from "./provider";
import { buildSystemPrompt } from "./prompts";
import {
  buildDirectives,
  computeSignals,
  looksLikeQuestion,
  type TurnContext,
} from "./rules";
import { responseSchema } from "./schemas";

/**
 * The Conversation Orchestrator — the product intelligence layer.
 * Context → rules → intention → model → post-validation → state + extraction.
 */

export interface OrchestrateResult {
  bubbles: string[];
  assistantMessages: MessageRow[];
  plan: AssistantResponse["plan"] | null;
  intention: ReturnType<typeof composeIntention> | null;
  directives: string[];
  /** She's out (asleep/gone) — message was stored, nothing was generated. */
  asleep: boolean;
  /** Simulated reply latency for the client's typing indicator. */
  replyDelayMs: number;
  /** Async memory extraction — await via after() so it never blocks the reply. */
  extraction: Promise<unknown>;
}

const GOODNIGHT = /\b(night|good ?night|sleep|bed|crash|gn\b|natt|😴|💤)\b/i;

/** She said goodnight within the last ~8h — that's binding, not a hint. */
function saidGoodnightRecently(recent: MessageRow[], now: Date = new Date()): boolean {
  const last = [...recent].reverse().find((m) => m.role === "assistant");
  if (!last) return false;
  const ageH = (now.getTime() - new Date(last.created_at).getTime()) / 3_600_000;
  return ageH < 8 && GOODNIGHT.test(last.content);
}

/**
 * Simulated reply latency — a person doesn't answer in 300ms forever.
 * Base jitter + typing time + late-hour penalty + loose mirroring of his pace.
 */
function replyDelayMs(opts: {
  bubbles: string[];
  fading: boolean;
  lastUserGapMs: number;
}): number {
  const base = 800 + Math.random() * 1800;
  const typing = Math.min(opts.bubbles.join("").length * 18, 4000);
  const late = opts.fading ? 1200 : 0;
  const mirror =
    opts.lastUserGapMs > 5 * 60_000 ? Math.min(opts.lastUserGapMs / 20, 8000) : 0;
  return Math.min(base + typing + late + mirror, 20_000);
}

export async function orchestrate(opts: {
  supabase: SupabaseClient;
  model: ChatModel;
  userId: string;
  userMessage: string;
  /** testability seam — presence/day-vibe compute against this clock */
  now?: Date;
}): Promise<OrchestrateResult> {
  const { supabase, model, userId, userMessage } = opts;
  const now = opts.now ?? new Date();

  // ── 1. Load context ───────────────────────────────────────────────────────
  const conversation = await getOrCreateConversation(supabase, userId);
  const [recent, allMemories, openLoops, state] = await Promise.all([
    getRecentMessages(supabase, conversation.id, CONFIG.rhythm.recentMessageWindow),
    getActiveMemories(supabase, userId),
    getOpenLoops(supabase, userId),
    getOrCreateState(supabase, userId),
  ]);

  const stage = stageForFamiliarity(state.familiarity);
  const tier: DisclosureTier = ({ new: 1, warming: 2, familiar: 2, close: 3 } as const)[stage];
  const lifeThreads = (await getLifeThreads(supabase, tier)).filter(
    (t) => effectiveStatus(t) !== "resolved"
  );

  // ── 1b. Presence — she is not always on ───────────────────────────────────
  const lastUserMsg = [...recent].reverse().find((m) => m.role === "user");
  const convoActive =
    lastUserMsg != null &&
    now.getTime() - new Date(lastUserMsg.created_at).getTime() < 20 * 60_000;
  const presence = herPresence({
    userId,
    hasHistory: recent.length > 0,
    saidGoodnight: saidGoodnightRecently(recent, now),
    convoActive,
    now,
  });

  if (presence.state === "out") {
    // She's asleep/gone — the message lands, she'll see it later.
    // Still extract: whatever he said at 2am informs tomorrow's reply.
    await insertMessage(supabase, {
      conversation_id: conversation.id,
      role: "user",
      content: userMessage,
    });
    await supabase
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", conversation.id);
    const extraction = extractAndStore({
      model,
      supabase,
      userId,
      conversationId: conversation.id,
      exchange: [
        ...recent.slice(-4).map((m) => ({ role: m.role, content: m.content })),
        { role: "user" as const, content: userMessage },
      ],
      existingMemories: allMemories,
      existingLoops: openLoops,
    }).catch((e) => console.error("[extract] failed:", e));
    return {
      bubbles: [],
      assistantMessages: [],
      plan: null,
      intention: null,
      directives: ["presence: out"],
      asleep: true,
      replyDelayMs: 0,
      extraction,
    };
  }

  // ── 2. Memory retrieval ───────────────────────────────────────────────────
  const recentEntities = extractRecentEntities(recent);
  const retriever = new HeuristicRetriever();
  const retrieved = retriever.retrieve(allMemories, {
    userMessage,
    recentEntities,
    openLoops,
  });

  // ── 3. Rules → directives ─────────────────────────────────────────────────
  const ctx: TurnContext = {
    userMessage,
    recentMessages: recent.map((m) => ({
      role: m.role,
      content: m.content,
      created_at: m.created_at,
    })),
    memories: retrieved.map((r) => r.memory),
    openLoops,
    state,
  };
  const signals = computeSignals(ctx);
  const directives = buildDirectives(ctx, signals);
  if (presence.promptLine) {
    directives.push({
      rule: "presence",
      reason: `presence=${presence.state}`,
      text: presence.promptLine,
    });
  }
  const intention = composeIntention(ctx, signals, directives);

  // ── 4. Build prompt + generate ────────────────────────────────────────────
  const systemPrompt = buildSystemPrompt({
    state,
    stage,
    tier,
    memories: retrieved,
    openLoops,
    lifeThreads,
    directives,
    intention,
    isFirstConversation: recent.length === 0,
    dayVibe: presence.vibe,
  });

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...recent.map((m): ChatMessage => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  let out = await model.generateStructured({
    schema: responseSchema,
    messages,
    temperature: 0.85,
    maxTokens: 900,
  });

  // ── 5. Post-validation — hard rules get teeth ─────────────────────────────
  const hardNoQuestion =
    signals.questionBudgetLeft === 0 || directives.some((d) => d.noQuestion);
  if (hardNoQuestion && out.bubbles.some(looksLikeQuestion)) {
    out = await model.generateStructured({
      schema: responseSchema,
      messages: [
        ...messages,
        {
          role: "user",
          content:
            "Your previous reply asked a question. Rewrite WITHOUT any question — react, share, or state instead. Same JSON format.",
        },
      ],
      temperature: 0.7,
      maxTokens: 900,
    });
  }

  // Length sanity: deterministic bubble cap per target length — kills the
  // "restate the same beat in three bubbles" failure mode. Form reshapes the
  // cap: bursts get room, singles collapse to one bubble.
  let bubbleCap = { one_liner: 1, short: 1, medium: 2, long: 4 }[
    intention.targetLength
  ];
  if (intention.form === "burst") bubbleCap = Math.min(bubbleCap + 2, 4);
  if (intention.form === "single") bubbleCap = Math.min(bubbleCap, 1);
  if (intention.targetLength === "one_liner") {
    const shortest = [...out.bubbles].sort((a, b) => a.length - b.length)[0];
    out.bubbles = [shortest];
  } else {
    out.bubbles = out.bubbles.slice(0, bubbleCap);
  }
  // Never empty.
  out.bubbles = out.bubbles.filter((b) => b.trim());
  if (!out.bubbles.length) out.bubbles = ["hmm"];

  // ── 6. Persist messages ───────────────────────────────────────────────────
  await insertMessage(supabase, {
    conversation_id: conversation.id,
    role: "user",
    content: userMessage,
  });
  const assistantMessages: MessageRow[] = [];
  for (const [i, content] of out.bubbles.entries()) {
    assistantMessages.push(
      await insertMessage(supabase, {
        conversation_id: conversation.id,
        role: "assistant",
        content,
        meta: {
          bubble_index: i,
          plan: out.plan,
          intention,
          beat: state.current_beat,
          directives: directives.map((d) => d.rule),
        },
      })
    );
  }
  await supabase
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversation.id);

  // ── 7. State update ───────────────────────────────────────────────────────
  const asked = out.bubbles.some(looksLikeQuestion);
  const fam = computeFamiliarity(state, {
    meaningfulExchange: out.bubbles.join(" ").length > 200 || signals.expressesEmotion,
  });
  const proposedBeat = out.plan.beat_transition;
  const nextBeat: Beat =
    proposedBeat &&
    (validBeatTransition(state.current_beat, proposedBeat) ||
      (signals.wantsAdvice && proposedBeat === "action"))
      ? proposedBeat
      : state.current_beat === "free_chat" && signals.expressesEmotion
        ? "problem_introduced"
        : state.current_beat;

  // A new Stockholm day resets her mood baseline to today's vibe — she's not
  // the same person every morning. Within the day, momentum decays toward it.
  const isNewStockholmDay =
    !state.last_interaction_at ||
    herNow(new Date(state.last_interaction_at)).date !== herNow(now).date;

  const patch: Partial<ConversationStateRow> = {
    // model-proposed register, pulled slightly toward baseline (momentum)
    ...(out.state_update ?? {}),
    her_mood:
      out.state_update?.her_mood ??
      (isNewStockholmDay ? presence.vibe.mood : state.her_mood),
    consecutive_ai_questions: asked ? state.consecutive_ai_questions + 1 : 0,
    act_histogram: pushActs(state.act_histogram, intention.acts),
    familiarity: fam.familiarity,
    stage: fam.stage,
    days_active: fam.daysActive,
    active_dates: fam.activeDates,
    depth_points: fam.depthPoints,
    last_depth_date: fam.lastDepthDate,
    current_beat: nextBeat,
    beat_started_at:
      nextBeat !== state.current_beat ? new Date().toISOString() : state.beat_started_at,
    last_interaction_at: new Date().toISOString(),
    her_energy: decayed(
      out.state_update?.her_energy ??
        (isNewStockholmDay ? presence.vibe.energy : state.her_energy),
      presence.vibe.energy
    ),
    warmth: decayed(
      signals.isRude ? Math.max(0, state.warmth - CONFIG.familiarity.rudenessWarmthPenalty) : (out.state_update?.warmth ?? state.warmth),
      0.6
    ),
  };
  await applyStateUpdate(supabase, userId, patch);

  // Touch last_referenced on memories actually used.
  const usedIds = out.plan.memory_ids_used.filter((id) =>
    allMemories.some((m) => m.id === id)
  );
  if (usedIds.length) {
    await supabase
      .from("memories")
      .update({ last_referenced_at: new Date().toISOString() })
      .in("id", usedIds);
  }

  // Track what this user knows about her life.
  if (out.plan.wants_to_mention_life_thread) {
    const thread = lifeThreads.find(
      (t) => t.slug === out.plan.wants_to_mention_life_thread
    );
    if (thread) {
      await supabase.from("life_thread_state").upsert({
        user_id: userId,
        thread_id: thread.id,
        last_mentioned_at: new Date().toISOString(),
      });
    }
  }

  // ── 8. Async memory extraction — never blocks the reply ──────────────────
  const exchange = [
    ...recent.slice(-4).map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: userMessage },
    ...out.bubbles.map((b) => ({ role: "assistant" as const, content: b })),
  ];
  const extraction = extractAndStore({
    model,
    supabase,
    userId,
    conversationId: conversation.id,
    exchange,
    existingMemories: allMemories,
    existingLoops: openLoops,
  }).catch((e) => console.error("[extract] failed:", e));

  // How long he took to send this message — loosely mirrors his pace.
  const lastAssistant = [...recent].reverse().find((m) => m.role === "assistant");
  const hisGapMs =
    lastAssistant && lastUserMsg
      ? new Date(lastUserMsg.created_at).getTime() -
        new Date(lastAssistant.created_at).getTime()
      : 0;

  return {
    bubbles: out.bubbles,
    assistantMessages,
    plan: out.plan,
    intention,
    directives: directives.map((d) => `${d.rule}: ${d.reason}`),
    asleep: false,
    replyDelayMs: replyDelayMs({
      bubbles: out.bubbles,
      fading: presence.state === "fading",
      lastUserGapMs: Math.max(0, hisGapMs),
    }),
    extraction,
  };
}

function extractRecentEntities(messages: { content: string }[]): string[] {
  // Lightweight entity pull: capitalized words in recent turns.
  const entities = new Set<string>();
  for (const m of messages.slice(-8)) {
    for (const w of m.content.split(/\s+/)) {
      const cleaned = w.replace(/[^A-Za-zÅÄÖåäö'-]/g, "");
      if (cleaned.length > 2 && /^[A-ZÅÄÖ]/.test(cleaned) && cleaned.toLowerCase() !== cleaned) {
        entities.add(cleaned);
      }
    }
  }
  return [...entities];
}
