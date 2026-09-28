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
  } else if (s.asksAboutHer) {
    acts.push("share"); // asked about her → share real specifics
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

  // Turn-taking disclosure (Sprecher): he gave something real → she gives
  // something real back BEFORE another question. Not gated on stage —
  // the tier system already bounds what she'd reveal.
  if (
    (s.disclosureDepth === "personal" || s.disclosureDepth === "emotional") &&
    !acts.includes("share") &&
    !s.asksAboutHer
  ) {
    acts.push("share");
  }

  // Callback to an open loop or earlier conversation.
  if (has("open_loop") || has("contradiction") || has("returning_greeting")) {
    acts.push(has("contradiction") ? "challenge" : "callback");
  }

  // Tease — earned with familiarity, natural on light messages.
  const canTease = ctx.state.stage !== "new" && !s.expressesEmotion && !s.isRude;
  if (canTease && Math.random() < 0.25) acts.push("tease");

  // Ask — bounded by budget, cooldown, and reciprocity, not reflexive.
  // Not on topics she wouldn't care about, and not while he's low-effort.
  const mayAsk =
    s.questionBudgetLeft > 0 &&
    !has("question_cap") &&
    !s.questionCooldown &&
    !s.userPushesBack &&
    s.topicInterest !== "low" &&
    s.hisInvestment !== "low" &&
    !(s.askHeavy && !s.expressesEmotion);
  const shouldAsk =
    s.expressesEmotion || // explore feelings
    s.topicInterest === "high" || // genuinely curious — follow-up territory
    (!s.wantsInfo && !s.asksAboutHer && Math.random() < 0.4);
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

  // ── Form — the shape of the reply, so every turn isn't react|take|ask ────
  // single: one bubble, dry/cool. burst: rapid micro-bubbles (invested).
  // ramble: one real thought out loud. Randomness keeps it unpredictable.
  let form: Intention["form"] = "single";
  const invested =
    s.expressesEmotion ||
    s.asksAboutHer ||
    s.topicInterest === "high" ||
    s.disclosureDepth === "personal" ||
    s.disclosureDepth === "emotional";
  const dry =
    s.isShortCasual || s.hisInvestment === "low" || s.isRude || s.topicPivot;
  if (dry || targetLength === "one_liner" || targetLength === "short") {
    form = "single";
  } else if (invested && Math.random() < 0.45) {
    form = "burst";
  } else if (
    (s.wantsAdvice ||
      ctx.state.current_beat === "exploring" ||
      ctx.state.current_beat === "deeper_context") &&
    Math.random() < 0.5
  ) {
    form = "ramble";
  } else {
    form = Math.random() < 0.3 ? "burst" : "single";
  }

  return { acts: unique, openness, targetLength, form };
}
