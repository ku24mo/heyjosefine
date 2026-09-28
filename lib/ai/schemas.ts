import { z } from "zod";

const beatEnum = z.enum([
  "free_chat",
  "problem_introduced",
  "exploring",
  "deeper_context",
  "reflection",
  "decision",
  "action",
  "open_loop_created",
]);

const memoryCategoryEnum = z.enum([
  "personal_fact",
  "goal",
  "relationship",
  "preference",
  "emotion",
  "event",
  "pattern",
]);

const entityTypeEnum = z.enum([
  "person",
  "place",
  "event",
  "goal",
  "conversation",
  "thing",
]);

/** Word-form numbers the model occasionally emits instead of a float. */
const WORD_NUM: Record<string, number> = {
  "very low": 0.15,
  low: 0.3,
  medium: 0.5,
  moderate: 0.5,
  high: 0.8,
  "very high": 0.95,
};

/** "0.7" → 0.7, "75%" → 75, "high" → 0.8; unparseable passes through. */
const toNumber = (v: unknown): unknown => {
  if (typeof v !== "string") return v;
  const s = v.trim().toLowerCase();
  const n = parseFloat(s.replace(/[^0-9.\-]/g, ""));
  if (!Number.isNaN(n)) return n;
  return WORD_NUM[s] ?? v;
};

/** Models often emit 0-100 despite asking for 0-1 — normalize either way. */
const unitInterval = z.preprocess(
  (v) => {
    const n = toNumber(v);
    return typeof n === "number" && n > 1 ? n / 100 : n;
  },
  z.number().min(0).max(1)
);

/** Advisory state fields: a garbage value drops the field, not the reply. */
const softUnit = unitInterval.optional().catch(undefined);

/** Reply bubbles: tolerate a bare string, blanks, and >4 entries. */
const bubblesArray = z.preprocess(
  (v) => {
    const arr = typeof v === "string" ? [v] : v;
    return Array.isArray(arr)
      ? arr.filter((b) => typeof b === "string" && b.trim()).slice(0, 4)
      : arr;
  },
  z.array(z.string().min(1)).min(1).max(4)
);

/**
 * Drop unparseable array items instead of failing the whole payload —
 * DeepSeek occasionally emits enum variants; losing one item beats losing
 * the entire extraction.
 */
const lenientArray = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess(
    (v) => (Array.isArray(v) ? v.filter((i) => item.safeParse(i).success) : []),
    z.array(item)
  );

/** importance/emotional_weight 1-10; models may emit 0-100 or "8". */
const score110 = z.preprocess(
  (v) => {
    const n = toNumber(v);
    if (typeof n !== "number") return n;
    if (n > 10) return n / 10;
    return n;
  },
  z.number().min(1).max(10)
);

/**
 * Per-turn response. `plan` is internal reasoning — never shown.
 * The model proposes; the orchestrator disposes (see rules.ts/intention.ts).
 */
export const responseSchema = z.object({
  plan: z.object({
    user_intent: z.string().describe("what the user is actually saying, one line"),
    user_emotion: z
      .string()
      .nullable()
      .describe("dominant emotion in the user message, or null"),
    move: z
      .string()
      .describe("her suggested conversational move — advisory, may be overridden"),
    memory_ids_used: z.array(z.string()).default([]),
    beat_transition: beatEnum.nullable().catch(null).default(null),
    wants_to_mention_life_thread: z.string().nullable().default(null),
  })
    .catch({
      user_intent: "",
      user_emotion: null,
      move: "",
      memory_ids_used: [],
      beat_transition: null,
      wants_to_mention_life_thread: null,
    }),
  bubbles: bubblesArray.describe(
    "the reply as 1-4 texting-style message bubbles"
  ),
  state_update: z
    .object({
      mood: z.string(),
      energy: softUnit,
      warmth: softUnit,
      curiosity: softUnit,
      seriousness: softUnit,
      recent_emotion: z.string().nullable().catch(null),
      current_topic: z.string().nullable().catch(null),
      her_mood: z.string(),
      her_energy: softUnit,
    })
    .partial()
    .optional(),
});
export type ResponseOutput = z.infer<typeof responseSchema>;

const newMemorySchema = z.object({
  category: memoryCategoryEnum,
  content: z.string(),
  importance: score110,
  confidence: unitInterval,
  keywords: z.array(z.string()).default([]),
  entities: z
    .array(z.object({ type: entityTypeEnum, name: z.string() }))
    .default([]),
  learned_from_user: z
    .boolean()
    .default(false)
    .describe("true if this is something she learned about the world FROM the user"),
  supporting_memory_ids: z
    .array(z.string())
    .default([])
    .describe("required for category 'pattern': ≥2 prior memory ids as evidence"),
});

const memoryUpdateSchema = z.object({
  id: z.string(),
  content: z.string().optional(),
  confidence: unitInterval.optional(),
  importance: score110.optional(),
  status: z.enum(["active", "archived"]).optional(),
  related_memory_ids: z.array(z.string()).optional(),
});

const openLoopUpdateSchema = z.object({
  action: z.enum(["create", "resolve", "cancel", "stale"]),
  id: z.string().optional().describe("existing loop id for non-create actions"),
  description: z.string().optional(),
  importance: score110.optional(),
  emotional_weight: score110.optional(),
  due_hint: z.string().nullable().optional(),
  related_memory_ids: z.array(z.string()).optional(),
});

/** Post-turn extraction (async — never blocks the reply). */
export const extractionSchema = z.object({
  conversation_summary: z
    .string()
    .describe("what is happening right now in this conversation, 1-3 sentences"),
  new_memories: lenientArray(newMemorySchema).default([]),
  memory_updates: lenientArray(memoryUpdateSchema).default([]),
  open_loop_updates: lenientArray(openLoopUpdateSchema).default([]),
});
export type ExtractionOutput = z.infer<typeof extractionSchema>;

/** Opening message generation (lib/ai/opening.ts). */
export const openingSchema = z.object({
  bubbles: bubblesArray,
});
export type OpeningOutput = z.infer<typeof openingSchema>;
