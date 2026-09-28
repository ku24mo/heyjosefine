import type { Act, Intention } from "@/lib/types";
import type { Directive, Signals, TurnContext } from "./rules";

/**
 * Conversation intention — the composition of acts for this turn.
 * "react + share + ask" is a different turn than "answer + ask".
 * That distinction is the assistant-vs-person boundary.
 */
export function composeIntention(
  ctx: TurnContext,
  s: Signals,
  directives: Directive[]
): Intention {
  const has = (rule: string) => directives.some((d) => d.rule === rule);
  const acts: Act[] = [];

  // ── Lead act ──────────────────────────────────────────────────────────────
  if (s.isRude) {
    acts.push("challenge");
  } else if (s.wantsInfo) {
    acts.push("answer");
  } else if (s.expressesEmotion) {
    acts.push("react"); // acknowledge first, always
  } else if (s.isShortCasual) {
    acts.push("react");
  } else {
    // Default lead: react like a person, not answer like an assistant.
    acts.push(Math.random() < 0.35 ? "share" : "react");
  }

  // ── Secondary acts ────────────────────────────────────────────────────────
  // Share her own stuff — especially when ask-heavy or she has a live thread.
  if ((s.askHeavy || acts.includes("react")) && ctx.state.stage !== "new") {
    if (!acts.includes("share") && Math.random() < 0.4) acts.push("share");
  }

  // Callback to an open loop or earlier conversation.
  if (has("open_loop") || has("contradiction") || has("returning_greeting")) {
    acts.push(has("contradiction") ? "challenge" : "callback");
  }

  // Tease — earned with familiarity, natural on light messages.
  const canTease = ctx.state.stage !== "new" && !s.expressesEmotion && !s.isRude;
  if (canTease && Math.random() < 0.25) acts.push("tease");

  // Ask — bounded by budget and reciprocity, not reflexive.
  const mayAsk =
    s.questionBudgetLeft > 0 &&
    !has("question_cap") &&
    !(s.askHeavy && !s.expressesEmotion);
  const shouldAsk =
    s.expressesEmotion || // explore feelings
    (!s.wantsInfo && Math.random() < 0.55); // curiosity, not habit
  if (mayAsk && shouldAsk) acts.push("ask");

  // Dedupe, cap at 3 acts.
  const unique = [...new Set(acts)].slice(0, 3);

  // ── Openness ──────────────────────────────────────────────────────────────
  let openness: Intention["openness"] = "resolve";
  if (s.mentionsNewTopic && !s.expressesEmotion) openness = "change_topic";
  else if (has("leave_open") || (s.emotionalCharge && Math.random() < 0.5))
    openness = "leave_open";

  // ── Length ────────────────────────────────────────────────────────────────
  let targetLength: Intention["targetLength"] = "medium";
  if (has("returning_greeting")) targetLength = "short";
  else if (s.isShortCasual) targetLength = "one_liner";
  else if (s.expressesEmotion) targetLength = "medium";
  else if (s.wantsAdvice || s.wantsInfo) targetLength = "medium";
  if (ctx.userMessage.trim().split(/\s+/).length <= 2 && !has("returning_greeting"))
    targetLength = "one_liner";

  return { acts: unique, openness, targetLength };
}
