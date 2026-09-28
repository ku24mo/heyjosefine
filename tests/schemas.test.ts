import { describe, expect, it } from "vitest";
import { responseSchema, extractionSchema } from "@/lib/ai/schemas";

const validPlan = {
  user_intent: "testing",
  user_emotion: null,
  move: "react",
  memory_ids_used: [],
  beat_transition: null,
  wants_to_mention_life_thread: null,
};

describe("response schema leniency", () => {
  it("degrades invalid beat_transition to null", () => {
    const out = responseSchema.parse({
      plan: { ...validPlan, beat_transition: "casual_chat" },
      bubbles: ["hey"],
    });
    expect(out.plan.beat_transition).toBeNull();
    expect(out.bubbles).toEqual(["hey"]);
  });

  it("recovers bubbles when plan is malformed", () => {
    const out = responseSchema.parse({
      plan: "i dunno",
      bubbles: ["hey there"],
    });
    expect(out.bubbles).toEqual(["hey there"]);
    expect(out.plan.beat_transition).toBeNull();
  });

  it("coerces string and word-form numbers in state_update", () => {
    const out = responseSchema.parse({
      plan: validPlan,
      bubbles: ["hey"],
      state_update: { her_energy: "high", warmth: "0.75", energy: 75 },
    });
    expect(out.state_update?.her_energy).toBeCloseTo(0.8);
    expect(out.state_update?.warmth).toBeCloseTo(0.75);
    expect(out.state_update?.energy).toBeCloseTo(0.75);
  });

  it("accepts a bare string as bubbles", () => {
    const out = responseSchema.parse({ plan: validPlan, bubbles: "just this" });
    expect(out.bubbles).toEqual(["just this"]);
  });
});

describe("extraction schema leniency", () => {
  it("drops malformed items instead of failing the batch", () => {
    const out = extractionSchema.parse({
      conversation_summary: "chatting",
      new_memories: [
        {
          category: "goal",
          content: "wants to quit job",
          importance: 8,
          confidence: 0.9,
        },
        { category: "bogus", content: "bad", importance: 5, confidence: 0.5 },
      ],
      open_loop_updates: [
        { action: "create", description: "job decision", importance: 8 },
        { action: "frobnicate", description: "bad action" },
      ],
    });
    expect(out.new_memories).toHaveLength(1);
    expect(out.open_loop_updates).toHaveLength(1);
  });
});
