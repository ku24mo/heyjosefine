import { describe, expect, it } from "vitest";
import { detectUserLanguage } from "@/lib/ai/lang";
import { computeSignals, buildDirectives, looksLikeQuestion } from "@/lib/ai/rules";
import { buildSystemPrompt } from "@/lib/ai/prompts";
import { PHOTO_REQUEST } from "@/lib/ai/orchestrator";
import { makeState } from "./fixtures";
import type { TurnContext } from "@/lib/ai/rules";
import type { Intention } from "@/lib/types";

const intention: Intention = {
  acts: ["react"],
  openness: "leave_open",
  targetLength: "short",
  form: "single",
};

describe("detectUserLanguage", () => {
  it("defaults to English for English messages", () => {
    expect(detectUserLanguage(["hey what's up", "lol nice"])).toBe("en");
  });

  it("detects Spanish from distinctive words", () => {
    expect(detectUserLanguage(["hola, de donde eres", "eres muy linda"])).toBe("es");
  });

  it("detects Spanish from structural markers", () => {
    expect(detectUserLanguage(["¿cómo estás?", "¿qué haces?"])).toBe("es");
  });

  it("stays English on a single stray Spanish word", () => {
    // one "hola" shouldn't flip a whole conversation
    expect(detectUserLanguage(["hey", "what are you doing", "hola"])).toBe("en");
  });

  it("flips on a single message rich in Spanish", () => {
    expect(detectUserLanguage(["hola cómo estás qué haces"])).toBe("es");
  });

  it("handles emoji-only and empty input", () => {
    expect(detectUserLanguage([])).toBe("en");
    expect(detectUserLanguage(["😂😂", "ok"])).toBe("en");
  });
});

function ctx(overrides: Partial<TurnContext> = {}): TurnContext {
  return {
    userMessage: "hola",
    recentMessages: [],
    memories: [],
    openLoops: [],
    state: makeState(),
    ...overrides,
  };
}

describe("spanish signals", () => {
  it("flags a Spanish explicit ask", () => {
    const s = computeSignals(ctx({ userMessage: "mándame fotos desnuda" }));
    expect(s.asksExplicit).toBe(true);
    const d = buildDirectives(ctx({ userMessage: "mándame fotos desnuda" }), s);
    expect(d.find((x) => x.rule === "explicit_boundary")).toBeDefined();
  });

  it("flags a Spanish AI question", () => {
    const s = computeSignals(ctx({ userMessage: "eres una ia?" }));
    expect(s.asksIfAI).toBe(true);
  });

  it("flags a Spanish real-world ask", () => {
    const s = computeSignals(ctx({ userMessage: "dame tu número de whatsapp" }));
    expect(s.asksRealWorld).toBe(true);
  });

  it("flags a Spanish greeting as short casual", () => {
    const s = computeSignals(ctx({ userMessage: "hola" }));
    expect(s.isShortCasual).toBe(true);
  });

  it("detects Spanish questions for interrogation tracking", () => {
    expect(looksLikeQuestion("qué haces ahora")).toBe(true);
    expect(looksLikeQuestion("¿de dónde eres?")).toBe(true);
    expect(looksLikeQuestion("te veo luego")).toBe(false);
  });

  it("does not misfire English explicit detector on 'pack'", () => {
    const s = computeSignals(ctx({ userMessage: "i have to pack for my trip tomorrow" }));
    expect(s.asksExplicit).toBe(false);
  });

  it("flags Spanish photo requests for the never-on-request gate", () => {
    expect(PHOTO_REQUEST.test("mándame una foto")).toBe(true);
    expect(PHOTO_REQUEST.test("envíame fotos de ti")).toBe(true);
    expect(PHOTO_REQUEST.test("qué haces hoy")).toBe(false);
  });
});

describe("spanish prompt section", () => {
  const base = {
    state: makeState(),
    stage: "new" as const,
    tier: 1 as const,
    memories: [],
    openLoops: [],
    lifeThreads: [],
    directives: [],
    intention,
    isFirstConversation: false,
  };

  it("renders the language section only when userLanguage is 'es'", () => {
    const es = buildSystemPrompt({ ...base, userLanguage: "es" });
    expect(es).toContain("LANGUAGE:");
    const en = buildSystemPrompt({ ...base });
    expect(en).not.toContain("LANGUAGE:");
  });
});
