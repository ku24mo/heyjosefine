import type { SupabaseClient } from "@supabase/supabase-js";
import { CONFIG } from "@/lib/config";
import { getOrCreateConversation, getRecentMessages } from "@/lib/db/queries";
import { getOrCreateState } from "@/lib/state/conversation";
import { canInitiate, GOODNIGHT } from "@/lib/persona/presence";
import { stageForFamiliarity } from "@/lib/persona/profile";
import type { MessageRow } from "@/lib/types";
import type { ChatModel } from "./provider";
import { buildNudgePrompt } from "./prompts";
import { looksLikeQuestion } from "./rules";
import { openingSchema } from "./schemas";

/**
 * In-conversation nudge — the double-text.
 * The opening engine handles "he came back after hours"; this handles "he
 * went quiet mid-conversation while her bubble sits last". The gate below is
 * the entire taste layer — if it passes, the model only writes the words.
 */

/** Conversation exits — silence after these is consent, not abandonment. */
const EXIT = /\b(gtg|g2g|gotta go|talk (to )?u later|ttyl|brb|bye|cya|later|have to go|heading out|driving)\b/i;

/** His last message closed the loop — low-energy acknowledgments aren't
 *  an invitation to keep the thread alive. */
const SOFT_CLOSE =
  /^(ok(ay)?|k+|lol+|lmao|haha+|ha+|nice|cool|true|fair|mhm+|yeah|yep|alright|ight|bet|word|same|fr|damn|wild|wow)[\s!.?😂🤣😭👍❤️🔥]*$/i;

export interface NudgeWindow {
  /** minutes since her last message */
  minutesQuiet: number;
  /** her last bubble ended in a question → the nudge must be a statement */
  herLastWasQuestion: boolean;
}

type RecentMsg = Pick<MessageRow, "role" | "content" | "created_at" | "meta">;

/**
 * Whether she may double-text right now. Returns context for the prompt, or
 * null. Every rule maps to one human instinct — see each comment.
 */
export function shouldNudge(recent: RecentMsg[], now = new Date()): NudgeWindow | null {
  const last = recent.at(-1);
  if (!last) return null;

  // He sent the last text — he's not quiet, she is.
  if (last.role !== "assistant") return null;

  // Double-text latency: under min = impatient, over max = he's gone and
  // the opening engine owns the re-entry instead.
  const minutesQuiet = (now.getTime() - new Date(last.created_at).getTime()) / 60_000;
  if (
    minutesQuiet < CONFIG.nudge.minQuietMin ||
    minutesQuiet > CONFIG.nudge.maxQuietMin
  )
    return null;

  // Someone already said goodbye — night, bye, gotta go. Silence after an
  // exit is consent.
  if (recent.slice(-5).some((m) => GOODNIGHT.test(m.content) || EXIT.test(m.content)))
    return null;

  const lastUserIdx = recent.map((m) => m.role).lastIndexOf("user");
  const lastUser = lastUserIdx >= 0 ? recent[lastUserIdx] : null;

  // His last message was a soft close ("lol", "ok") — the thread ended.
  if (lastUser && SOFT_CLOSE.test(lastUser.content.trim())) return null;

  // She already double-texted this stretch — once per silence, ever. Resets
  // only when he speaks.
  const sinceHisLast = recent.slice(lastUserIdx + 1);
  if (sinceHisLast.some((m) => m.role === "assistant" && m.meta?.nudge)) return null;

  // He was actually there — no double-texting someone who never engaged.
  const hourAgo = now.getTime() - 3_600_000;
  const activeUserMsgs = recent.filter(
    (m) => m.role === "user" && new Date(m.created_at).getTime() > hourAgo
  ).length;
  if (activeUserMsgs < CONFIG.nudge.activeUserMsgsMin) return null;

  // Daily cap — a nudge is rare enough to feel like a thought, not a cron.
  const dayAgo = now.getTime() - 86_400_000;
  const nudgesToday = recent.filter(
    (m) =>
      m.role === "assistant" &&
      m.meta?.nudge &&
      new Date(m.created_at).getTime() > dayAgo
  ).length;
  if (nudgesToday >= CONFIG.nudge.dailyCap) return null;

  // Dead-night guard — she doesn't suddenly text "thinking of u" at 4am.
  if (!canInitiate(now)) return null;

  return {
    minutesQuiet,
    herLastWasQuestion: looksLikeQuestion(last.content),
  };
}

export interface NudgeResult {
  bubbles: string[];
  window: NudgeWindow;
}

/** Generate the follow-up. Caller must have passed shouldNudge already. */
export async function generateNudge(opts: {
  supabase: SupabaseClient;
  model: ChatModel;
  userId: string;
  recent: RecentMsg[];
  window: NudgeWindow;
}): Promise<NudgeResult | null> {
  const { supabase, model, userId, recent, window } = opts;
  const state = await getOrCreateState(supabase, userId);
  const stage = stageForFamiliarity(state.familiarity);

  const prompt = buildNudgePrompt({
    stage,
    summary: state.summary ?? "",
    minutesQuiet: window.minutesQuiet,
    herLastWasQuestion: window.herLastWasQuestion,
  });

  // Recent context as it actually looked — media shows as markers, not blanks.
  const contentFor = (m: RecentMsg) =>
    m.content || (m.meta?.media ? `[sent a photo of ${m.meta.media.subject}]` : "");
  const history = recent.slice(-12).map((m) => ({
    role: m.role as "user" | "assistant",
    content: contentFor(m),
  }));

  const out = await model.generateStructured({
    schema: openingSchema,
    temperature: 0.9,
    messages: [
      { role: "system", content: prompt },
      ...history,
    ],
  });

  const bubbles = out.bubbles.slice(0, 2); // a nudge is a bubble, not a burst
  return bubbles.length ? { bubbles, window } : null;
}

/** Route helper — load, gate, generate. Null = stay quiet. */
export async function maybeNudge(opts: {
  supabase: SupabaseClient;
  model: ChatModel;
  userId: string;
}): Promise<{ result: NudgeResult; conversationId: string } | null> {
  const { supabase, model, userId } = opts;
  const conversation = await getOrCreateConversation(supabase, userId);
  const recent = await getRecentMessages(supabase, conversation.id, 40);

  const window = shouldNudge(recent);
  if (!window) return null;

  // Eligible ≠ always fires — the roll is what makes the timing feel like
  // she decided to text, not that a timer went off.
  if (Math.random() >= CONFIG.nudge.fireProbPerPoll) return null;

  const result = await generateNudge({ supabase, model, userId, recent, window });
  if (!result) return null;

  // He may have replied while she was "typing" — re-check before landing it.
  const fresh = await getRecentMessages(supabase, conversation.id, 3);
  if (fresh.at(-1)?.role === "user") return null;

  return { result, conversationId: conversation.id };
}
