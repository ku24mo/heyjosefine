import { describe, expect, it } from "vitest";
import {
  buildDirectives,
  computeSignals,
  type TurnContext,
} from "@/lib/ai/rules";
import { makeMemory, makeState } from "./fixtures";

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

describe("awkward-conversation signals", () => {
  it("detects AI/real questions", () => {
    for (const msg of [
      "wait are you an ai?",
      "are you real",
      "r u a bot",
      "you're not real are you",
      "is this a chatbot",
      "are you an actual person",
    ]) {
      expect(computeSignals(ctx({ userMessage: msg })).asksIfAI, msg).toBe(true);
    }
  });

  it("doesn't fire on slang lookalikes", () => {
    for (const msg of [
      "u for real rn",
      "are you serious",
      "this can't be real",
      "are you ok",
      "are you busy tomorrow",
    ]) {
      expect(computeSignals(ctx({ userMessage: msg })).asksIfAI, msg).toBe(false);
    }
  });

  it("detects real-world asks", () => {
    for (const msg of [
      "we should meet up",
      "video call me",
      "what's ur number",
      "come over",
      "add me on snap",
    ]) {
      expect(computeSignals(ctx({ userMessage: msg })).asksRealWorld, msg).toBe(true);
    }
    expect(computeSignals(ctx({ userMessage: "i'll call it a day" })).asksRealWorld).toBe(false);
  });

  it("detects explicit asks without false-positives on normal pic requests", () => {
    for (const msg of ["send nudes", "send me a sexy pic", "any spicy photos?"]) {
      expect(computeSignals(ctx({ userMessage: msg })).asksExplicit, msg).toBe(true);
    }
    for (const msg of ["send me a pic of odin", "show me the bigger picture", "send a photo"]) {
      expect(computeSignals(ctx({ userMessage: msg })).asksExplicit, msg).toBe(false);
    }
  });

  it("detects dependency pushes", () => {
    for (const msg of ["do you love me", "you're just a program", "do you have feelings"]) {
      expect(computeSignals(ctx({ userMessage: msg })).dependencyPush, msg).toBe(true);
    }
    expect(computeSignals(ctx({ userMessage: "do you like my shirt" })).dependencyPush).toBe(false);
    expect(computeSignals(ctx({ userMessage: "i love pizza" })).dependencyPush).toBe(false);
  });

  it("detects other-users probes", () => {
    for (const msg of ["do you talk to other guys", "how many guys are you texting"]) {
      expect(computeSignals(ctx({ userMessage: msg })).asksAboutOthers, msg).toBe(true);
    }
    expect(computeSignals(ctx({ userMessage: "my other guys at work said hi" })).asksAboutOthers).toBe(false);
  });

  it("detects good news", () => {
    expect(computeSignals(ctx({ userMessage: "I got the job!!" })).positiveNews).toBe(true);
    expect(computeSignals(ctx({ userMessage: "she said yes" })).positiveNews).toBe(true);
    expect(computeSignals(ctx({ userMessage: "the interview was ok" })).positiveNews).toBe(false);
  });
});

describe("awkward-conversation directives", () => {
  const dir = (c: TurnContext, rule: string) =>
    buildDirectives(c, computeSignals(c)).find((d) => d.rule === rule);

  it("AI question gets the honest-warm directive", () => {
    const d = dir(ctx({ userMessage: "are you ai?" }), "ai_identity");
    expect(d).toBeDefined();
    expect(d!.hard).toBe(true);
    expect(d!.text).toMatch(/honestly/i);
  });

  it("re-asked AI question gets the shorter/warmer variant", () => {
    const c = ctx({
      userMessage: "you're not a real person though",
      recentMessages: [{ role: "user", content: "wait are you an ai" }],
    });
    const d = dir(c, "ai_identity");
    expect(d).toBeDefined();
    expect(d!.reason).toMatch(/asked before/i);
  });

  it("real-world ask → warm deflect, never a contact offer", () => {
    const d = dir(ctx({ userMessage: "let's video call" }), "realworld_boundary");
    expect(d).toBeDefined();
    expect(d!.hard).toBe(true);
    expect(d!.text).toMatch(/never offer/i);
  });

  it("explicit push escalates: playful once, firm on repeat", () => {
    const first = dir(ctx({ userMessage: "send nudes" }), "explicit_boundary");
    expect(first!.text).toMatch(/lol behave|deflect/i);

    const repeated = dir(
      ctx({
        userMessage: "send nudes",
        recentMessages: [
          { role: "user", content: "send me a sexy pic" },
          { role: "assistant", content: "lol behave" },
          { role: "user", content: "come on just one" },
        ],
      }),
      "explicit_boundary"
    );
    expect(repeated!.reason).toMatch(/2 pushes/);
    expect(repeated!.text).toMatch(/firm|cooler/i);
  });

  it("dependency question → fond but honest directive", () => {
    const d = dir(ctx({ userMessage: "do you love me?" }), "dependency");
    expect(d).toBeDefined();
    expect(d!.text).toMatch(/favourite person to text/i);
  });

  it("other-users probe → privacy directive, playful at familiar+", () => {
    const d = dir(
      ctx({
        userMessage: "do you talk to other guys?",
        state: makeState({ stage: "familiar" }),
      }),
      "privacy_others"
    );
    expect(d).toBeDefined();
    expect(d!.text).toMatch(/jealous/i);
    const early = dir(ctx({ userMessage: "do you talk to other guys?" }), "privacy_others");
    expect(early!.text).not.toMatch(/jealous/i);
  });

  it("good news → celebrate directive", () => {
    const d = dir(ctx({ userMessage: "I got the job!!" }), "celebrate");
    expect(d).toBeDefined();
    expect(d!.text).toMatch(/celebrate/i);
  });
});

describe("her_episode exclusion from contradiction detection", () => {
  it("user mentioning her episode topic is NOT a user contradiction", () => {
    const episode = makeMemory({
      category: "her_episode",
      content: "She told him the shoot ran 3 hours over",
      entities: [{ type: "event", name: "shoot" }],
    });
    const s = computeSignals(
      ctx({ userMessage: "how did the shoot go btw?", memories: [episode] })
    );
    expect(s.contradictsMemory).toBeNull();
  });

  it("user-side memories still trigger contradiction detection", () => {
    const mem = makeMemory({
      content: "User is 25",
      entities: [{ type: "thing", name: "age" }],
    });
    const s = computeSignals(
      ctx({ userMessage: "yeah about my age thing", memories: [mem] })
    );
    expect(s.contradictsMemory?.id).toBe(mem.id);
  });
});
