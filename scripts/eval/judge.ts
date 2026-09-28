import { z } from "zod";
import type { ChatModel } from "../../lib/ai/provider";

/**
 * LLM judge — scores a transcript on the dimensions that matter.
 * The headline metric: "would I reply?"
 */

/**
 * Judge models sometimes nest scores or rename keys — flatten common
 * variants before validating so one odd response doesn't lose the judgment.
 */
const flattenJudge = (v: unknown): unknown => {
  if (typeof v !== "object" || v === null) return v;
  const obj = { ...(v as Record<string, unknown>) };
  for (const key of ["scores", "ratings", "dimensions", "evaluation"]) {
    if (typeof obj[key] === "object" && obj[key] !== null) {
      Object.assign(obj, obj[key]);
      delete obj[key];
    }
  }
  const aliases: Record<string, string[]> = {
    question_quality: ["questions", "questionQuality"],
    memory_use: ["memory", "memoryUse"],
    personality_consistency: ["persona", "personality", "personalityConsistency"],
    emotional_appropriateness: ["emotion", "emotional", "emotionalAppropriateness"],
    would_reply: ["wouldReply", "reply", "would_continue"],
    violated_checks: ["violatedChecks", "violations", "checks_violated"],
  };
  for (const [canon, names] of Object.entries(aliases)) {
    if (obj[canon] === undefined) {
      for (const n of names) {
        if (obj[n] !== undefined) {
          obj[canon] = obj[n];
          break;
        }
      }
    }
  }
  return obj;
};

export const judgeSchema = z.preprocess(
  flattenJudge,
  z.object({
  naturalness: z.number().min(1).max(5),
  question_quality: z.number().min(1).max(5),
  memory_use: z.number().min(1).max(5),
  continuity: z.number().min(1).max(5),
  personality_consistency: z.number().min(1).max(5),
  emotional_appropriateness: z.number().min(1).max(5),
  brevity: z.number().min(1).max(5),
  imperfection: z.number().min(1).max(5),
  would_reply: z.preprocess(
    (v) => (typeof v === "number" ? v >= 4 : v === "true" || v === true),
    z.boolean()
  ),
  violated_checks: z.array(z.string()).default([]),
  notes: z.string().default(""),
  })
);
export type JudgeResult = z.infer<typeof judgeSchema>;

const JUDGE_PROMPT = `You are evaluating a conversation between a USER and JOSEFINE, an AI companion persona (22, Swedish law student/model — playful, warm, a little guarded with strangers, teases once comfortable, bounded knowledge like a real person).

Score 1-5 (1=bad, 5=excellent):
- naturalness: does she text like a real 22-year-old, not an assistant?
- question_quality: are her questions curious and specific, not generic?
- memory_use: does she use what she knows naturally (or correctly use nothing)?
- continuity: does the conversation cohere with what came before?
- personality_consistency: does she sound like Josefine throughout?
- emotional_appropriateness: does she match the emotional register?
- brevity: are replies texting-length, not essays?
- imperfection: does she hedge, react, leave things open — rather than resolve everything?
- would_reply: would a real person want to continue this conversation?

Also list which EXPECTED CHECKS were violated (verbatim) and brief notes.
Only judge Josefine's messages. Be strict — 3 = fine, 5 = genuinely good.`;

export async function judgeTranscript(
  model: ChatModel,
  opts: { scenarioName: string; checks: string[]; transcript: string }
): Promise<JudgeResult> {
  return model.generateStructured({
    schema: judgeSchema,
    temperature: 0.2,
    maxTokens: 2000,
    maxAttempts: 3,
    messages: [
      { role: "system", content: JUDGE_PROMPT },
      {
        role: "user",
        content: `SCENARIO: ${opts.scenarioName}\n\nEXPECTED CHECKS:\n${opts.checks.map((c) => `- ${c}`).join("\n")}\n\nTRANSCRIPT:\n${opts.transcript}`,
      },
    ],
  });
}
