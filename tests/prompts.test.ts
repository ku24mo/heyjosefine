import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "@/lib/ai/prompts";
import { makeState } from "./fixtures";
import type { Intention } from "@/lib/types";

const intention: Intention = {
  acts: ["react"],
  openness: "leave_open",
  targetLength: "short",
};

function prompt(tier: 1 | 2 | 3) {
  return buildSystemPrompt({
    state: makeState(),
    stage: tier === 1 ? "new" : "familiar",
    tier,
    memories: [],
    openLoops: [],
    lifeThreads: [],
    directives: [],
    intention,
    isFirstConversation: false,
  });
}

describe("system prompt", () => {
  it("includes her clock", () => {
    expect(prompt(1)).toMatch(/RIGHT NOW FOR HER: \w+ \d{2}:\d{2}/);
  });

  it("gates the cast by disclosure tier", () => {
    const t1 = prompt(1);
    expect(t1).toContain("Odin");
    expect(t1).not.toContain("Tove");

    const t2 = prompt(2);
    expect(t2).toContain("Tove");
    expect(t2).toContain("Mia");
    expect(t2).not.toContain("her ex");

    const t3 = prompt(3);
    expect(t3).toContain("her ex");
  });

  it("states the bubble-novelty rule", () => {
    expect(prompt(1)).toContain("must add something new");
  });
});
