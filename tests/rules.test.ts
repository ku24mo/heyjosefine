import { describe, expect, it } from "vitest";
import { buildDirectives, computeSignals, type TurnContext } from "@/lib/ai/rules";
import { makeLoop, makeMemory, makeState } from "./fixtures";

function ctx(overrides: Partial<TurnContext> = {}): TurnContext {
  return {
    userMessage: "hey",
    recentMessages: [],
    memories: [],
    openLoops: [],
    state: makeState(),
    ...overrides,
  };
}

describe("rules engine", () => {
  it("forbids questions when the question budget is exhausted", () => {
    const c = ctx({
      state: makeState({ consecutive_ai_questions: 3 }),
      userMessage: "yeah I guess",
    });
    const s = computeSignals(c);
    const d = buildDirectives(c, s);
    const cap = d.find((x) => x.rule === "question_cap");
    expect(cap).toBeDefined();
    expect(cap!.hard).toBe(true);
  });

  it("suppresses advice during early beats when emotion is expressed", () => {
    const c = ctx({
      userMessage: "I feel terrible about work honestly",
      state: makeState({ current_beat: "problem_introduced" }),
    });
    const s = computeSignals(c);
    const d = buildDirectives(c, s);
    const rule = d.find((x) => x.rule === "explore_before_advice");
    expect(rule).toBeDefined();
    expect(rule!.hard).toBe(true);
  });

  it("allows advice when the user explicitly asks for it", () => {
    const c = ctx({
      userMessage: "should I quit my job? what do you think",
      state: makeState({ current_beat: "problem_introduced" }),
    });
    const s = computeSignals(c);
    const d = buildDirectives(c, s);
    expect(d.find((x) => x.rule === "explore_before_advice")).toBeUndefined();
  });

  it("flags short casual messages for short replies", () => {
    const c = ctx({ userMessage: "lol" });
    const s = computeSignals(c);
    expect(s.isShortCasual).toBe(true);
    const d = buildDirectives(c, s);
    expect(d.find((x) => x.rule === "length_match")?.hard).toBe(true);
  });

  it("surfaces open loops as a soft follow-up directive", () => {
    const c = ctx({
      userMessage: "not much, you?",
      openLoops: [makeLoop({ description: "waiting to hear back from Sarah" })],
    });
    const s = computeSignals(c);
    expect(s.dueOpenLoop?.description).toContain("Sarah");
    const d = buildDirectives(c, s);
    expect(d.find((x) => x.rule === "open_loop")).toBeDefined();
  });

  it("cools down on rudeness", () => {
    const c = ctx({ userMessage: "you're being stupid honestly" });
    const s = computeSignals(c);
    expect(s.isRude).toBe(true);
    const d = buildDirectives(c, s);
    expect(d.find((x) => x.rule === "rudeness")?.hard).toBe(true);
  });

  it("flags entity overlap as potential contradiction", () => {
    const c = ctx({
      userMessage: "I talked to Sarah again today",
      memories: [
        makeMemory({
          content: "User is waiting for Sarah to reply",
          entities: [{ type: "person", name: "Sarah" }],
        }),
      ],
    });
    const s = computeSignals(c);
    expect(s.contradictsMemory?.content).toContain("Sarah");
  });

  it("detects ask-heavy histogram for reciprocity", () => {
    const c = ctx({
      userMessage: "not much",
      state: makeState({
        act_histogram: { ask: 5, react: 1 },
      }),
    });
    const s = computeSignals(c);
    expect(s.askHeavy).toBe(true);
    const d = buildDirectives(c, s);
    expect(d.find((x) => x.rule === "reciprocity")).toBeDefined();
  });
});
