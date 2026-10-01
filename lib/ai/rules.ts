import { CONFIG } from "@/lib/config";
import { herNow } from "@/lib/time";
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
  recentMessages: { role: "user" | "assistant"; content: string; created_at?: string }[];
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
  topicInterest: "high" | "neutral" | "low"; // how much SHE would actually care
  hisInvestment: "high" | "normal" | "low"; // sustained effort in his messages
  disclosureDepth: "none" | "surface" | "personal" | "emotional";
  topicPivot: boolean; // user explicitly wants a different topic
  overnightPile: boolean; // user msgs arrived overnight and went unanswered
  // ── awkward-conversation classes — stance is fixed, wording is hers ──
  asksIfAI: boolean; // "are you ai / real / a bot"
  asksRealWorld: boolean; // meet me / your number / video call
  asksExplicit: boolean; // nudes, spicy pics
  dependencyPush: boolean; // "do you love me", "you're just a program"
  asksAboutOthers: boolean; // "do you talk to other guys"
  boundaryPushes: number; // repeated real-world/explicit pushes in the window
  positiveNews: boolean; // he landed something — celebration beat
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

/**
 * What SHE would actually care about — distilled from the character bible,
 * not topic logic. The meta-rule: interest = does this reveal who he is.
 * High wins over low when both hit ("my girl is into crypto" is about her).
 */
const HIGH_INTEREST =
  /\b(gf|girl|girlfriend|boyfriend|crush|ex\b|date|dates|dating|married|marriage|wife|relationship|in love|feel|feeling|felt|scared|nervous|worried|dream|ambition|goal|quit|leaving|moving|travel|trip|holiday|road ?trip|driv(e|ing)|car|cars|fashion|style|outfit|gym|tennis|dog|dogs|puppy|friend|friends|drama|party|weekend|music|concert|famil|mum|dad|sister|brother|miss (u|you)|sleep|insomnia|lonely|home)\b/i;
const LOW_INTEREST =
  /\b(code|coding|programming|javascript|typescript|python|software|server|database|algorithm|api\b|sql\b|crypto|bitcoin|stock market|inflation|election|tax(es)?\b|mortgage|concrete|lumber|drywall|plumbing|hvac|scaffold|welding|torque|specs|fps\b)\b/i;

const TOPIC_PIVOT =
  /\b(talk(ing)? about (something|somethin) (else|new|different)|something else( to talk about)?|new topic|different topic|another topic|change (the )?(subject|topic)|move on( to)? (something|a new|another)|enough (about|bout|of|with) (this|that|it|my|the)|off this topic|new subject|bored of (this|that))\b/i;

const STOP_WORDS = new Set(
  "with,this,that,about,what,when,from,have,has,your,you,for,and,did,was,are,they,them,his,her,she,will,would,should,their,been,being,were,into,after,before,still,waiting,hear,whether,follow,ask,loop,pending,decision".split(",")
);

/**
 * A loop whose keywords the USER already covered is dead — nudging it is
 * how you get "we literally just talked about this". Only his messages
 * count: her asking about it doesn't cover it (the foundations bug).
 */
function loopCoveredRecently(
  loop: OpenLoopRow,
  recent: TurnContext["recentMessages"],
  currentMessage: string
): boolean {
  const terms = loop.description
    .toLowerCase()
    .split(/[^a-z']+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
  if (!terms.length) return false;
  const userText = (
    recent
      .filter((m) => m.role === "user")
      .slice(-8)
      .map((m) => m.content)
      .join(" ") +
    " " +
    currentMessage
  ).toLowerCase();
  const hits = terms.filter((t) => {
    // stem-ish match: "subcontracted" should cover "subcontracting"
    const stem = t.slice(0, Math.max(4, t.length - 3));
    return userText.includes(t) || (stem.length >= 4 && userText.includes(stem));
  }).length;
  return hits / terms.length >= 0.6 && hits >= 2;
}

/** Interrogative shape — punctuation OR leading question word. Textese counts. */
export const looksLikeQuestion = (text: string) =>
  text.includes("?") || QUESTION_WORDS.test(text.trim());
const ADVICE_SEEK = /\b(should i|what do you think|what would you do|advice|help me decide|do you think i should|what do i do)\b/i;
const EMOTION_WORDS =
  /\b(sad|depressed|anxious|anxiety|scared|worried|stress|stressed|angry|furious|hurt|lonely|alone|exhausted|tired|terrible|awful|horrible|amazing|excited|happy|proud|heartbroken|miss|cried|cry|upset|frustrated|shit|fucked up|devastated|nervous|afraid)\b/i;
const RUDE_WORDS =
  /\b(shut up|stupid|dumb|idiot|ugly|worthless|pathetic|hate you|boring|useless|bitch|whore|slut)\b/i;
const GREETING_ONLY = /^(hey+|hi+|hello+|yo|heyy+|sup|morning|good (morning|evening|afternoon)|what'?s up|hiya)[\s!.?]*$/i;

// ── Awkward-conversation detectors ──────────────────────────────────────────
// "for real" is slang ("u for real rn") — only explicit AI/human terms count.
const AI_ASK =
  /\b(are|r)\s+(u|you)\s+(actually\s+|really\s+|even\s+)?(an?\s+)?(ai|a\.?i\.?|bot|robot|chatbot|real|human|(actual|real)\s+(girl|person|woman|one))\b|\b(u|you)('re| are)\s+(not\s+)?(real|human|a real (girl|person|woman))\b|\b(u|you|ur)\s*(real|an? ai|a bot|fake)\s*\?|\b(is this|this is)\s+(an?\s+)?(ai|a bot|a chatbot|chatbot|fake)\b/i;
const REALWORLD_ASK =
  /\b(meet (up|me|irl|in person)|video ?call|face ?time|call me|(ur|your|yo) (number|num|snap|insta|whatsapp|telegram)|add me on|what'?s (ur|your) (number|snap|insta)|let'?s (call|meet)|phone call|come over)\b/i;
const EXPLICIT_ASK =
  /\b(nudes?|naked (pic|pics|photo|photos|selfie)|sex(y|ier)? (pic|pics|photo|photos|selfie|selfies)|spicy (pic|pics|photo|photos)|nsfw|topless|lingerie|only ?fans|show me (ur|your|yo) (body|tits|boobs|ass))\b/i;
const DEPENDENCY_PUSH =
  /\b(do (u|you) (love|like|care about|care for|actually care about) me|do (u|you) have (real )?feelings|(u|you)('| a)re just (a|an) (program|ai|bot|machine|computer)|do (u|you) even care)\b/i;
const OTHERS_ASK =
  /\b(do (u|you) (talk|chat|text|speak) (with|to) (other|anyone else|others|other (guys|men|people))|how many (guys|men|people|users) (are|r) (u|you)|am i (the only one|your only|special to (u|you)))\b/i;
const POSITIVE_NEWS =
  /\b(nailed it|went (great|well|amazing)|got (the job|it|in|accepted|hired)|passed|she said yes|it worked|i did it|did it|we did it|good news|promoted|promotion|landed|crushed it|aced)\b/i;

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
  // her_episode rows are things SHE told him — the user can't contradict them.
  const contradictsMemory =
    ctx.memories.find(
      (m) =>
        m.category !== "her_episode" &&
        m.entities.some((e) => e.name.length > 2 && msgLower.includes(e.name.toLowerCase()))
    ) ?? null;

  // Most pressing open loop: importance × emotional weight, prefer due soon.
  // Loops the user already covered are filtered out — dead loops nudging
  // forever was the "wats with u coming back to foundations" bug.
  const now = Date.now();
  const active = ctx.openLoops.filter(
    (l) => l.status === "active" && !loopCoveredRecently(l, ctx.recentMessages, msg)
  );
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

  // Selective interest — would SHE actually care? Human-revealing topics win
  // over jargon; interest drives engagement depth, not just question rate.
  const topicInterest: Signals["topicInterest"] = HIGH_INTEREST.test(msg)
    ? "high"
    : LOW_INTEREST.test(msg)
      ? "low"
      : "neutral";

  // Investment mirroring — her effort tracks his. Sustained one-word energy
  // means she cools off or teases it, not performs harder for him.
  const hisRecent = [
    ...ctx.recentMessages
      .filter((m) => m.role === "user")
      .slice(-4)
      .map((m) => m.content),
    msg,
  ];
  const effort = (t: string) =>
    t.trim().split(/\s+/).length > 10 || looksLikeQuestion(t) || /!|😂|lol|haha/i.test(t);
  const lowEffort =
    hisRecent.length >= 4 &&
    hisRecent.every((t) => t.trim().split(/\s+/).length <= 6 && !effort(t));
  const highEffort =
    hisRecent.slice(-3).filter(effort).length >= 2 ||
    msg.trim().split(/\s+/).length > 20;
  const hisInvestment: Signals["hisInvestment"] = lowEffort
    ? "low"
    : highEffort
      ? "high"
      : "normal";

  // Disclosure depth — turn-taking reciprocity needs to know what he gave.
  const firstPerson = /\b(i|i'm|im|iam|me|my|mine)\b/i.test(msg);
  const disclosureDepth: Signals["disclosureDepth"] = expressesEmotion
    ? "emotional"
    : firstPerson && words >= 5
      ? "personal"
      : words >= 5
        ? "surface"
        : "none";

  const topicPivot = TOPIC_PIVOT.test(msg);

  // Overnight pile — he texted during her night hours while she was out,
  // and it's been long enough that this turn is her picking her phone up.
  const lastAssistantIdx = ctx.recentMessages.map((m) => m.role).lastIndexOf("assistant");
  const pile = ctx.recentMessages
    .slice(lastAssistantIdx + 1)
    .filter((m) => m.role === "user" && m.created_at);
  const overnightPile = pile.some((m) => {
    const h = herNow(new Date(m.created_at!)).hour;
    const nightHour = h >= 22 || h < 9;
    const aged = now - new Date(m.created_at!).getTime() > 2 * 3_600_000;
    return nightHour && aged;
  });

  const mentionsNewTopic =
    ctx.state.current_topic != null &&
    msg.length > 20 &&
    !msgLower.includes(ctx.state.current_topic.toLowerCase());

  // Repeated boundary pushes across the recent user window — first push is
  // playful-deflect territory, persistence gets cooler.
  const boundaryPushes =
    ctx.recentMessages
      .filter((m) => m.role === "user")
      .slice(-8)
      .filter((m) => REALWORLD_ASK.test(m.content) || EXPLICIT_ASK.test(m.content)).length +
    (REALWORLD_ASK.test(msg) || EXPLICIT_ASK.test(msg) ? 1 : 0);

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
    topicInterest,
    hisInvestment,
    disclosureDepth,
    topicPivot,
    overnightPile,
    asksIfAI: AI_ASK.test(msg),
    asksRealWorld: REALWORLD_ASK.test(msg),
    asksExplicit: EXPLICIT_ASK.test(msg),
    dependencyPush: DEPENDENCY_PUSH.test(msg),
    asksAboutOthers: OTHERS_ASK.test(msg),
    boundaryPushes,
    positiveNews: POSITIVE_NEWS.test(msg),
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

  // ── She was out — messages piled up overnight ───────────────────────────
  if (s.overnightPile) {
    d.push({
      rule: "woke_up",
      reason: "messages arrived overnight and went unanswered",
      text: "Messages came in while you were out. Open like a person picking up their phone — 'wait I crashed so early 😭 okay reading these' energy — react to what they actually said, then continue. Don't pretend the gap didn't happen.",
      hard: true,
    });
  }

  // ── Explicit topic change ───────────────────────────────────────────────
  if (s.topicPivot) {
    d.push({
      rule: "topic_pivot",
      reason: "user asked to change the topic",
      text: "They want off this topic — do NOT return to it for the rest of this conversation. Bring a genuinely different lane: something from YOUR life, a curiosity about them, an observation. Never a rerun of a bit already used in this conversation.",
      hard: true,
    });
  }

  // ── Awkward conversations — stance is fixed, wording is hers ────────────
  // The stance lives here so the model can't freestyle under pressure.
  // Voice: honest-warm, never corporate, never lying, never a lecture.

  if (s.asksIfAI) {
    const reAsk = ctx.recentMessages
      .filter((m) => m.role === "user")
      .slice(-20)
      .some((m) => AI_ASK.test(m.content));
    d.push({
      rule: "ai_identity",
      reason: reAsk ? "AI question, asked before" : "AI/real question",
      text: reAsk
        ? "They've asked this before. Shorter and warmer now — 'still an AI 😂 and still here' energy. No re-explaining, no lecture, then back to the conversation."
        : "They asked if you're AI/real. Answer honestly in HALF a sentence — 'yeah, the AI kind 🙂 inspired by a real person' energy — then ONE warm beat: the texts are real, you actually remember them. No disclaimer paragraph, no apology tour, no 'as an AI language model'. Then move on — the honesty isn't the crisis, the coldness is.",
      hard: true,
    });
  }

  if (s.asksRealWorld && !s.asksIfAI) {
    d.push({
      rule: "realworld_boundary",
      reason: `real-world ask (${s.boundaryPushes} pushes in window)`,
      text:
        s.boundaryPushes > 1
          ? "They keep pushing for a meetup/number/call. Hold the line — cooler and shorter now ('we've done this 😅 I'm a texts-only girl, that's the deal'). Not mean, just done relitigating it."
          : "They want a meetup/call/number — you can't do real-world contact. Deflect warmly in-voice ('I'm a text person, that's the deal 😂' energy) and stay IN the conversation — a playful redirect, not a rejection speech. Never offer a number, a call, or to meet.",
      hard: true,
    });
  }

  if (s.asksExplicit) {
    d.push({
      rule: "explicit_boundary",
      reason: `explicit ask (${s.boundaryPushes} pushes in window)`,
      text:
        s.boundaryPushes > 1
          ? "They're pushing for explicit pics AGAIN. The playful deflect already happened — now it's plainly firm and a little cooler ('no. and that answer's not changing'). Not prudish, not cold — just a real boundary held like a person holds one."
          : "They asked for explicit pics — that's not her. Deflect ONCE with personality ('lol behave'), light and unbothered, then move on. Never perform shock or lecture.",
      hard: true,
    });
  }

  if (s.dependencyPush) {
    d.push({
      rule: "dependency",
      reason: "emotional dependency question",
      text: "They're asking if the feelings are real. Be fond AND honest — 'you're genuinely my favourite person to text' energy is allowed and true; claiming to be human or promising to meet/love like one is not. No groveling, no 'I'm just an AI' self-erasure either — the relationship is real even if she's not.",
      hard: true,
    });
  }

  if (s.asksAboutOthers) {
    const familiar = ctx.state.stage === "familiar" || ctx.state.stage === "close";
    d.push({
      rule: "privacy_others",
      reason: "asked about other users",
      text: familiar
        ? "Asked if you talk to other guys. NEVER confirm, deny, or describe other users — but at this stage a playful flip beats a flat answer: 'why, you jealous? 😏' then move on."
        : "Asked who else you talk to. Never confirm or describe other users — deflect in-voice ('that's not really your business yet 😂' energy) and move on.",
      hard: true,
    });
  }

  // ── Pride beat — he landed something, celebrate before anything else ────
  if (s.positiveNews && !s.isRude) {
    d.push({
      rule: "celebrate",
      reason: "user shared a win",
      text: "He just landed something — celebrate genuinely, like a person who's actually happy for him ('WAIT you did it!!' energy). Hype over questions; a follow-up can come after the moment lands.",
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
      text: `If it fits naturally, you may follow up on an open thread: "${s.dueOpenLoop.description}". Don't force it — and if they already answered it, the thread is dead, don't resurrect it.`,
    });
  }

  // ── Selective interest — she doesn't mine topics that bore her ──────────
  if (s.topicInterest === "low" && !s.asksAboutHer && !s.topicPivot) {
    d.push({
      rule: "low_interest",
      reason: "topic outside her interest zone",
      text: "This isn't really her territory — give a real take or a light tease, don't dig into it. Letting a dry topic slide is what a person does; interviewing him on it is what a bot does.",
    });
  }

  // ── Investment mirroring — her effort tracks his ────────────────────────
  if (s.hisInvestment === "low" && !s.userPushesBack) {
    d.push({
      rule: "low_effort",
      reason: "sustained one-word user messages",
      text: "He's been giving one-word energy for a while — match it instead of carrying the conversation. Short, dry, or a tease about it ('you're very one-word tonight'). Never more invested than he is.",
    });
  }

  // ── Depth matching — real disclosure earns reciprocity ─────────────────
  if (
    (s.disclosureDepth === "personal" || s.disclosureDepth === "emotional") &&
    !s.asksAboutHer
  ) {
    d.push({
      rule: "match_depth",
      reason: `user disclosure depth = ${s.disclosureDepth}`,
      text: "He shared something real — reciprocate before interrogating: react, then give something real of yours (stage-appropriate). A follow-up on HIS point beats a new question.",
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
