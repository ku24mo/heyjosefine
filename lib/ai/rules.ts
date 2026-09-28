import { CONFIG } from "@/lib/config";
import type {
  Beat,
  ConversationStateRow,
  MemoryRow,
  OpenLoopRow,
} from "@/lib/types";

/**
 * Deterministic directive engine — the real product brain.
 * Pure functions: context in → signals + directives out. Unit-tested heavily.
 * The model gets freedom INSIDE these boundaries, never around them.
 */

export interface TurnContext {
  userMessage: string;
  recentMessages: { role: "user" | "assistant"; content: string }[];
  memories: MemoryRow[];
  openLoops: OpenLoopRow[];
  state: ConversationStateRow;
}

export interface Directive {
  rule: string;
  reason: string;
  text: string; // injected into the prompt
  hard?: boolean; // enforced post-generation, not just suggested
  noQuestion?: boolean; // post-validation regenerates if the reply asks one
}

export interface Signals {
  asksQuestion: boolean;
  expressesEmotion: boolean;
  isShortCasual: boolean;
  isRude: boolean;
  wantsAdvice: boolean;
  wantsInfo: boolean;
  mentionsNewTopic: boolean;
  contradictsMemory: MemoryRow | null;
  dueOpenLoop: OpenLoopRow | null;
  questionBudgetLeft: number;
  askHeavy: boolean; // act histogram skewed toward asking
  questionCooldown: boolean; // too many questions across a recent window
  userPushesBack: boolean; // user called out the interrogation
  asksAboutHer: boolean; // user is asking about HER
  emotionalCharge: boolean;
  hoursSinceLast: number; // gap since the previous turn
}

const QUESTION_WORDS =
  /^(who|what|when|where|why|how|which|whose|whom|is|are|was|were|do|does|did|can|could|should|would|will|have|has|whr|whats|wat|wbu|hbu)\b/i;
const PUSHBACK =
  /\b(enough (about|bout|of)|stop (with )?(the |all )?questions|so many questions|why (are|r) (u|you) (so )?(interested|asking)|awfully interested|interview|interrogat|third degree)\b/i;
const ABOUT_HER = new RegExp(
  [
    "tell me (about|bout) (u|you|ur|yourself|urself)",
    "what about (u|you)",
    "what do (u|you) do",
    "whr (r |are )?(u|you)",
    "where (r|are) (u|you) from",
    "(u|you)r (name|job|work|life|story)",
    "do (u|you) (work|study|live)",
    "(u|you) (work|study|live) or",
  ].join("|"),
  "i"
);
const ABOUT_HER_BARE = /^(and )?(u|you|wbu|hbu|yours)[?!.\s]*$/i;

/** Interrogative shape — punctuation OR leading question word. Textese counts. */
export const looksLikeQuestion = (text: string) =>
  text.includes("?") || QUESTION_WORDS.test(text.trim());
const ADVICE_SEEK = /\b(should i|what do you think|what would you do|advice|help me decide|do you think i should|what do i do)\b/i;
const EMOTION_WORDS =
  /\b(sad|depressed|anxious|anxiety|scared|worried|stress|stressed|angry|furious|hurt|lonely|alone|exhausted|tired|terrible|awful|horrible|amazing|excited|happy|proud|heartbroken|miss|cried|cry|upset|frustrated|shit|fucked up|devastated|nervous|afraid)\b/i;
const RUDE_WORDS =
  /\b(shut up|stupid|dumb|idiot|ugly|worthless|pathetic|hate you|boring|useless|bitch|whore|slut)\b/i;
const GREETING_ONLY = /^(hey+|hi+|hello+|yo|heyy+|sup|morning|good (morning|evening|afternoon)|what'?s up|hiya)[\s!.?]*$/i;

export function computeSignals(ctx: TurnContext): Signals {
  const msg = ctx.userMessage.trim();
  const words = msg.split(/\s+/).length;

  const asksQuestion = looksLikeQuestion(msg);
  const expressesEmotion = EMOTION_WORDS.test(msg);
  const isShortCasual = words <= 4 || GREETING_ONLY.test(msg);
  const isRude = RUDE_WORDS.test(msg);
  const wantsAdvice = ADVICE_SEEK.test(msg);
  const wantsInfo = asksQuestion && !expressesEmotion;

  // Memory contradiction — cheap heuristic: user mentions an entity from a
  // stored memory (the model decides if it's actually a contradiction).
  const msgLower = msg.toLowerCase();
  const contradictsMemory =
    ctx.memories.find((m) =>
      m.entities.some((e) => e.name.length > 2 && msgLower.includes(e.name.toLowerCase()))
    ) ?? null;

  // Most pressing open loop: importance × emotional weight, prefer due soon.
  const now = Date.now();
  const active = ctx.openLoops.filter((l) => l.status === "active");
  const scored = active
    .map((l) => {
      const dueBoost =
        l.due_hint && new Date(l.due_hint).getTime() - now < 48 * 3600_000 ? 1.5 : 1;
      return { loop: l, score: l.importance * l.emotional_weight * dueBoost };
    })
    .sort((a, b) => b.score - a.score);
  const dueOpenLoop = scored[0]?.loop ?? null;

  const questionBudgetLeft = Math.max(
    0,
    CONFIG.rhythm.maxConsecutiveQuestions - ctx.state.consecutive_ai_questions
  );

  const hoursSinceLast = ctx.state.last_interaction_at
    ? (now - new Date(ctx.state.last_interaction_at).getTime()) / 3_600_000
    : 0;

  const acts = Object.entries(ctx.state.act_histogram ?? {});
  const total = acts.reduce((s, [, n]) => s + n, 0);
  const askCount = acts.find(([a]) => a === "ask")?.[1] ?? 0;
  const askHeavy = total >= 4 && askCount / total > 0.5;

  // Windowed question rate — consecutive-only caps are easy to evade with a
  // react+ask alternation, which still feels like an interview.
  const recentAssistant = ctx.recentMessages
    .filter((m) => m.role === "assistant")
    .slice(-CONFIG.rhythm.questionCooldownWindow);
  const recentQuestions = recentAssistant.filter((m) =>
    looksLikeQuestion(m.content)
  ).length;
  const questionCooldown = recentQuestions >= CONFIG.rhythm.questionCooldownMin;

  const userPushesBack = PUSHBACK.test(msg);
  const asksAboutHer = ABOUT_HER.test(msg) || ABOUT_HER_BARE.test(msg);

  const mentionsNewTopic =
    ctx.state.current_topic != null &&
    msg.length > 20 &&
    !msgLower.includes(ctx.state.current_topic.toLowerCase());

  return {
    asksQuestion,
    expressesEmotion,
    isShortCasual,
    isRude,
    wantsAdvice,
    wantsInfo,
    mentionsNewTopic,
    contradictsMemory,
    dueOpenLoop,
    questionBudgetLeft,
    askHeavy,
    questionCooldown,
    userPushesBack,
    asksAboutHer,
    emotionalCharge: expressesEmotion || ctx.state.recent_emotion != null,
    hoursSinceLast,
  };
}

const ADVICE_GATED_BEATS: Beat[] = [
  "problem_introduced",
  "exploring",
  "deeper_context",
];

export function buildDirectives(ctx: TurnContext, s: Signals): Directive[] {
  const d: Directive[] = [];
  const beat = ctx.state.current_beat;
  const msg = ctx.userMessage.trim();

  // ── Question budget ───────────────────────────────────────────────────────
  if (s.questionBudgetLeft === 0) {
    d.push({
      rule: "question_cap",
      reason: `${CONFIG.rhythm.maxConsecutiveQuestions} consecutive assistant questions`,
      text: "Do NOT end with or include a question this turn. React, share something of yours, or make a statement instead — interrogation mode is off.",
      hard: true,
      noQuestion: true,
    });
  }

  // ── Question cooldown (windowed) ─────────────────────────────────────────
  if (s.questionCooldown) {
    d.push({
      rule: "question_cooldown",
      reason: "too many questions across recent replies",
      text: "Do NOT ask a question this turn — react, share, or make a statement. They're starting to feel interviewed.",
      hard: true,
      noQuestion: true,
    });
  }

  // ── User called out the interrogation ────────────────────────────────────
  if (s.userPushesBack) {
    d.push({
      rule: "pushback",
      reason: "user pushed back on the questioning",
      text: "They just told you you're asking a lot. Own it lightly ('lol fair, okay no more questions') and do NOT ask anything this turn.",
      hard: true,
      noQuestion: true,
    });
  }

  // ── Emotion before advice ─────────────────────────────────────────────────
  if (s.expressesEmotion && ADVICE_GATED_BEATS.includes(beat) && !s.wantsAdvice) {
    d.push({
      rule: "explore_before_advice",
      reason: `beat=${beat}, emotion detected, no advice requested`,
      text: "The user is emotional and the situation isn't understood yet. Acknowledge + explore. Do NOT give advice, solutions, or lists.",
      hard: true,
    });
  }

  // ── Factual question → just answer ────────────────────────────────────────
  if (s.wantsInfo && !s.expressesEmotion) {
    d.push({
      rule: "answer_questions",
      reason: "user asked a question",
      text: "Answer the question naturally first — don't dodge it or answer with a question.",
    });
  }

  // ── Asked about HER → actually answer ─────────────────────────────────────
  if (s.asksAboutHer) {
    d.push({
      rule: "share_about_her",
      reason: "user asked about her",
      text: "They asked about YOU. Answer with 1-2 real specifics from your actual life (school, modeling, Odin — whatever fits) — short is fine, evasive is not ('not much to tell' is a banned dodge). A bounce-back question is optional, not required.",
    });
  }

  // ── Returning user greeting ───────────────────────────────────────────────
  // A bare "hey" after a gap with a live thread is not "just a short
  // message" — it's a natural place for ONE light check-in. This is the
  // continuity moment. Source: an open loop, or the hanging conversation
  // summary when no loop exists yet.
  const bareGreeting = GREETING_ONLY.test(msg);
  const hangingThread = s.dueOpenLoop?.description ?? (s.hoursSinceLast >= 4 && ctx.state.summary ? ctx.state.summary : null);
  if (bareGreeting && hangingThread) {
    d.push({
      rule: "returning_greeting",
      reason: `bare greeting + hanging thread "${hangingThread}"`,
      text: `They came back and just said hi. Greet them naturally — and if it fits, ONE light check-in about: "${hangingThread}" ("hey! wait, how'd the thing go?" energy). 1-2 short bubbles max — no big production.`,
      hard: true,
    });
  }

  // ── Open loop follow-up ───────────────────────────────────────────────────
  if (s.dueOpenLoop && ctx.state.consecutive_ai_questions < 2) {
    d.push({
      rule: "open_loop",
      reason: `active loop: "${s.dueOpenLoop.description}"`,
      text: `If it fits naturally, you may follow up on an open thread: "${s.dueOpenLoop.description}". Don't force it.`,
    });
  }

  // ── Contradiction ─────────────────────────────────────────────────────────
  if (s.contradictsMemory) {
    d.push({
      rule: "contradiction",
      reason: `message touches entity from memory "${s.contradictsMemory.content}"`,
      text: `The user mentioned something related to what they told you before ("${s.contradictsMemory.content}"). If this contradicts it, you may notice — "wait, didn't you say…?" — like a person would.`,
    });
  }

  // ── Reciprocity balance ───────────────────────────────────────────────────
  if (s.askHeavy) {
    d.push({
      rule: "reciprocity",
      reason: "assistant has been asking >50% of recent turns",
      text: "You've been asking a lot of questions. This turn: react or share something of your own FIRST. A question is optional.",
    });
  }

  // ── Length calibration ────────────────────────────────────────────────────
  if (s.isShortCasual && !d.some((x) => x.rule === "returning_greeting")) {
    d.push({
      rule: "length_match",
      reason: "short/casual user message",
      text: "The user sent something short or casual. Reply short — one line, an emoji, a small reaction. No paragraph.",
      hard: true,
    });
  }

  // ── Rudeness → cool down ──────────────────────────────────────────────────
  if (s.isRude) {
    d.push({
      rule: "rudeness",
      reason: "hostile wording detected",
      text: "The user is being rude or dismissive. She doesn't take abuse — reply cool and short, or call it out lightly ('okay wow'). Do not be warm or solicitous.",
      hard: true,
    });
  }

  // ── Leave-open pressure ───────────────────────────────────────────────────
  if (s.emotionalCharge && beat !== "free_chat") {
    d.push({
      rule: "leave_open",
      reason: "emotionally charged thread in progress",
      text: "Do NOT wrap this up neatly. Real conversations leave things hanging — 'hmm. idk actually', 'wait I'm thinking about that', or just a reaction are all valid endings.",
    });
  }

  return d;
}
