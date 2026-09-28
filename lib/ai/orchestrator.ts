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
import { stageForFamiliarity, type DisclosureTier } from "@/lib/persona/profile";
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
  plan: AssistantResponse["plan"];
  intention: ReturnType<typeof composeIntention>;
  directives: string[];
  /** Async memory extraction — await via after() so it never blocks the reply. */
  extraction: Promise<unknown>;
}

export async function orchestrate(opts: {
  supabase: SupabaseClient;
  model: ChatModel;
  userId: string;
  userMessage: string;
}): Promise<OrchestrateResult> {
  const { supabase, model, userId, userMessage } = opts;

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
    recentMessages: recent.map((m) => ({ role: m.role, content: m.content })),
    memories: retrieved.map((r) => r.memory),
    openLoops,
    state,
  };
  const signals = computeSignals(ctx);
  const directives = buildDirectives(ctx, signals);
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
  // "restate the same beat in three bubbles" failure mode.
  const bubbleCap = { one_liner: 1, short: 1, medium: 2, long: 4 }[
    intention.targetLength
  ];
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

  const patch: Partial<ConversationStateRow> = {
    // model-proposed register, pulled slightly toward baseline (momentum)
    ...(out.state_update ?? {}),
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
      out.state_update?.her_energy ?? state.her_energy,
      CONFIG.mood.baseline.energy
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

  return {
    bubbles: out.bubbles,
    assistantMessages,
    plan: out.plan,
    intention,
    directives: directives.map((d) => `${d.rule}: ${d.reason}`),
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
