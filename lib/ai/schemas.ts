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

/** Models often emit 0-100 despite asking for 0-1 — normalize either way. */
const unitInterval = z.preprocess(
  (v) => (typeof v === "number" && v > 1 ? v / 100 : v),
  z.number().min(0).max(1)
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

/** importance/emotional_weight 1-10; models may emit 0-100. */
const score110 = z.preprocess(
  (v) => {
    if (typeof v !== "number") return v;
    if (v > 10) return v / 10;
    return v;
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
    beat_transition: beatEnum.nullable().default(null),
    wants_to_mention_life_thread: z.string().nullable().default(null),
  }),
  bubbles: z
    .array(z.string().min(1))
    .min(1)
    .max(4)
    .describe("the reply as 1-4 texting-style message bubbles"),
  state_update: z
    .object({
      mood: z.string(),
      energy: unitInterval,
      warmth: unitInterval,
      curiosity: unitInterval,
      seriousness: unitInterval,
      recent_emotion: z.string().nullable(),
      current_topic: z.string().nullable(),
      her_mood: z.string(),
      her_energy: unitInterval,
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
  bubbles: z.array(z.string().min(1)).min(1).max(3),
});
export type OpeningOutput = z.infer<typeof openingSchema>;
