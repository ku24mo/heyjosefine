/**
 * All pacing/tuning constants in one place.
 * Believability tuning is the product work — change numbers here, not in logic.
 */
export const CONFIG = {
  // Memory
  memory: {
    minImportanceToStore: 4, // 1-10; below this it's not worth remembering
    maxRetrieved: 8, // memories injected into prompt per turn
    maxClusterExpansion: 4, // linked memories pulled per entity hit
    decayHalfLifeDays: 21, // confidence halves every N days since last_referenced_at
    minInjectConfidence: 0.25, // below this, memory isn't injected at all
    fuzzyBelow: 0.55, // below this, injected as a fuzzy/hedged recall
    recentFallbackCount: 3, // always include N most recent active memories
    patternMinConfidence: 0.8,
    patternMinEvidence: 2,
  },

  // Conversation rhythm
  rhythm: {
    maxConsecutiveQuestions: 3,
    questionCooldownWindow: 8, // assistant bubbles scanned for interrogative shape
    questionCooldownMin: 4, // ≥ this many questions in the window → forced statement turn
    recentMessageWindow: 24, // messages loaded per turn
    minDelayMs: 600, // typing indicator floor
    bubbleDelayMs: 900, // delay between bubble reveals
    perCharDelayMs: 8, // extra reveal time per character, capped
    maxRevealMs: 3500,
  },

  // Familiarity / trust arc — earned over days, not messages
  familiarity: {
    maxPerDay: 6, // hard cap on daily gain — trust can't be speedrun
    perDistinctDay: 4, // base gain for showing up on a new day
    perMeaningfulExchange: 0.5, // depth signal, capped by maxPerDay
    rudenessWarmthPenalty: 0.3, // warmth dips, familiarity intact
    stageThresholds: { warming: 15, familiar: 45, close: 75 },
  },

  // Opening engine
  opening: {
    minAbsenceHours: 4, // don't greet like she missed you after 20 minutes
    nudgeCooldownHours: 72, // per open loop
    maxOpenersConsidered: 5,
  },

  // LLM call bounds — a hung provider call can't hold the turn lock forever.
  llm: {
    timeoutMs: 45_000, // abort each model call after this
    maxRetries: 2, // transient 429/5xx retries inside the AI SDK
  },

  // Usage limits — guests get a taste, claimed accounts get the full free tier.
  usage: {
    guestTotalLimit: 30, // anonymous lifetime msgs → claim wall
    guestCreationsPerDay: 5, // per-IP anon sign-up cap
    freeDailyLimit: 40, // claimed: user messages per day
    freeTotalLimit: 150, // claimed lifetime cap → paywall
    burstPerMinute: 10, // rapid-fire cap — protects LLM spend, not the user
  },

  // Media sends — scarcity is realism; she shares pics like a person, not a feed.
  media: {
    dailyCap: 2, // max photos she'll send a user per day
    cooldownHours: 4, // min gap between sends
  },

  // Her life — episodes + day sheet
  life: {
    episodeMinImportance: 2, // lower bar than user facts — they're anchors that fade
    episodeMaxPerTurn: 3,
    threadCooldownDays: 2, // a mentioned thread rests this long before resurfacing
    dayMaxSlots: 6,
  },

  // Mood momentum
  mood: {
    decayPerTurn: 0.15, // drifts toward baseline each exchange
    baseline: { energy: 0.7, valence: 0.6 },
  },
} as const;
