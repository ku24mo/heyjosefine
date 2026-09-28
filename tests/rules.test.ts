import { describe, expect, it } from "vitest";
import {
  buildDirectives,
  computeSignals,
  looksLikeQuestion,
  type TurnContext,
} from "@/lib/ai/rules";
import { composeIntention } from "@/lib/ai/intention";
import { herNow } from "@/lib/time";
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

  it("counts questions without a question mark", () => {
    expect(looksLikeQuestion("what are you building")).toBe(true);
    expect(looksLikeQuestion("whr u frm")).toBe(true);
    expect(looksLikeQuestion("foundations make sense")).toBe(false);
  });

  it("cools down after a window of question-heavy replies", () => {
    const c = ctx({
      userMessage: "yeah",
      recentMessages: [
        { role: "assistant", content: "what kind of work" },
        { role: "user", content: "construction" },
        { role: "assistant", content: "what are you building" },
        { role: "user", content: "a house" },
        { role: "assistant", content: "nice. from scratch or adding onto something?" },
        { role: "user", content: "scratch" },
        { role: "assistant", content: "wait so it's almost done then" },
        { role: "user", content: "yeah" },
        { role: "assistant", content: "do you do the inside too or is that someone else" },
      ],
    });
    const s = computeSignals(c);
    expect(s.questionCooldown).toBe(true);
    const d = buildDirectives(c, s);
    const cd = d.find((x) => x.rule === "question_cooldown");
    expect(cd?.hard).toBe(true);
    expect(cd?.noQuestion).toBe(true);
  });

  it("does not trigger cooldown on a normal mixed history", () => {
    const c = ctx({
      userMessage: "yeah",
      recentMessages: [
        { role: "assistant", content: "that's a whole thing" },
        { role: "user", content: "yeah" },
        { role: "assistant", content: "what are you building" },
      ],
    });
    expect(computeSignals(c).questionCooldown).toBe(false);
  });

  it("detects user pushback on interrogation", () => {
    for (const msg of [
      "u seem awfully interested in houses i guess",
      "enough bout my work",
      "why are you asking so many questions",
    ]) {
      const c = ctx({ userMessage: msg });
      const s = computeSignals(c);
      expect(s.userPushesBack).toBe(true);
      const d = buildDirectives(c, s);
      const pb = d.find((x) => x.rule === "pushback");
      expect(pb?.hard).toBe(true);
      expect(pb?.noQuestion).toBe(true);
    }
  });

  it("detects questions about her", () => {
    for (const msg of [
      "tell me about urself",
      "whr u frm?",
      "wbu",
      "u work or study",
      "what do you do",
    ]) {
      const c = ctx({ userMessage: msg });
      const s = computeSignals(c);
      expect(s.asksAboutHer).toBe(true);
      const d = buildDirectives(c, s);
      expect(d.find((x) => x.rule === "share_about_her")).toBeDefined();
    }
  });

  it("does not flag about-her on unrelated messages", () => {
    for (const msg of ["I talked to Sarah", "had a rough day", "lol"]) {
      expect(computeSignals(ctx({ userMessage: msg })).asksAboutHer).toBe(false);
    }
  });

  it("intention excludes ask during cooldown and pushback", () => {
    const c = ctx({
      userMessage: "enough bout my work",
      recentMessages: [{ role: "assistant", content: "what else" }],
    });
    const s = computeSignals(c);
    const d = buildDirectives(c, s);
    const intention = composeIntention(c, s, d);
    expect(intention.acts).not.toContain("ask");
  });

  it("intention leads with share when asked about her", () => {
    const c = ctx({ userMessage: "tell me about urself" });
    const s = computeSignals(c);
    const d = buildDirectives(c, s);
    const intention = composeIntention(c, s, d);
    expect(intention.acts[0]).toBe("share");
  });

  it("suppresses open loops the user already covered (foundations bug)", () => {
    const c = ctx({
      userMessage: "foundations are done, we're subcontracting the inside work",
      recentMessages: [
        { role: "user", content: "will subcontract it" },
        { role: "assistant", content: "smart" },
      ],
      openLoops: [
        makeLoop({ description: "waiting to hear whether he subcontracted the inside work" }),
      ],
    });
    const s = computeSignals(c);
    expect(s.dueOpenLoop).toBeNull();
    const d = buildDirectives(c, s);
    expect(d.find((x) => x.rule === "open_loop")).toBeUndefined();
  });

  it("still surfaces a loop the user has NOT covered", () => {
    const c = ctx({
      userMessage: "not much today honestly",
      recentMessages: [{ role: "user", content: "will subcontract it" }],
      openLoops: [makeLoop({ description: "job interview Friday — how it went" })],
    });
    const s = computeSignals(c);
    expect(s.dueOpenLoop?.description).toContain("interview");
  });

  it("detects explicit topic pivots as a hard directive", () => {
    for (const msg of [
      "lets talk about something else",
      "can we change the subject",
      "enough about this",
      "new topic please",
    ]) {
      const c = ctx({ userMessage: msg });
      const s = computeSignals(c);
      expect(s.topicPivot).toBe(true);
      const d = buildDirectives(c, s);
      expect(d.find((x) => x.rule === "topic_pivot")?.hard).toBe(true);
    }
  });

  it("does not flag topic pivot on ordinary messages", () => {
    for (const msg of ["lol", "tell me more about that", "what about ur day"]) {
      expect(computeSignals(ctx({ userMessage: msg })).topicPivot).toBe(false);
    }
  });

  it("marks jargon-heavy topics as low interest for her", () => {
    const c = ctx({ userMessage: "the concrete curing specs and hvac layout are annoying" });
    const s = computeSignals(c);
    expect(s.topicInterest).toBe("low");
    const d = buildDirectives(c, s);
    expect(d.find((x) => x.rule === "low_interest")).toBeDefined();
  });

  it("marks people/emotion topics as high interest", () => {
    const c = ctx({ userMessage: "my girlfriend and I had a fight about the trip" });
    expect(computeSignals(c).topicInterest).toBe("high");
  });

  it("reads sustained one-word energy as low investment", () => {
    const c = ctx({
      userMessage: "ok",
      recentMessages: [
        { role: "user", content: "yeah" },
        { role: "assistant", content: "haha fair" },
        { role: "user", content: "sure" },
        { role: "assistant", content: "😂" },
        { role: "user", content: "ok" },
        { role: "assistant", content: "mm" },
        { role: "user", content: "k" },
      ],
    });
    const s = computeSignals(c);
    expect(s.hisInvestment).toBe("low");
    const d = buildDirectives(c, s);
    expect(d.find((x) => x.rule === "low_effort")).toBeDefined();
    const intention = composeIntention(c, s, d);
    expect(intention.acts).not.toContain("ask");
  });

  it("classifies first-person sharing as personal disclosure → match_depth + share act", () => {
    const c = ctx({ userMessage: "i work at a construction company in western sydney" });
    const s = computeSignals(c);
    expect(s.disclosureDepth).toBe("personal");
    const d = buildDirectives(c, s);
    expect(d.find((x) => x.rule === "match_depth")).toBeDefined();
    const intention = composeIntention(c, s, d);
    expect(intention.acts).toContain("share");
  });

  it("detects an overnight message pile after her night hours", () => {
    const now = new Date();
    const curHour = herNow(now).hour;
    const hrsBackTo1am = ((curHour - 1) + 24) % 24 || 24;
    const nightIso = new Date(now.getTime() - Math.max(hrsBackTo1am, 4) * 3_600_000).toISOString();
    const earlierIso = new Date(new Date(nightIso).getTime() - 3_600_000).toISOString();
    const c = ctx({
      userMessage: "morning",
      recentMessages: [
        { role: "assistant", content: "night 😴", created_at: earlierIso },
        { role: "user", content: "wait did you see the news", created_at: nightIso },
      ],
    });
    const s = computeSignals(c);
    // only overnight when the user msg actually landed in her night hours
    expect(s.overnightPile).toBe(herNow(new Date(nightIso)).hour >= 22 || herNow(new Date(nightIso)).hour < 9);
    const d = buildDirectives(c, s);
    if (s.overnightPile) {
      expect(d.find((x) => x.rule === "woke_up")?.hard).toBe(true);
    }
  });

  it("assigns a form on every intention", () => {
    const c = ctx({ userMessage: "my girlfriend and I had a huge fight about the trip we planned" });
    const s = computeSignals(c);
    const d = buildDirectives(c, s);
    const intention = composeIntention(c, s, d);
    expect(["burst", "single", "ramble"]).toContain(intention.form);
  });
});
