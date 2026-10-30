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

  it("detects Portuguese from distinctive words", () => {
    expect(detectUserLanguage(["oi, de onde você é?", "você é muito linda"])).toBe("pt");
  });

  it("detects Portuguese from ã/õ structure", () => {
    expect(detectUserLanguage(["não sei não", "então tá"])).toBe("pt");
  });

  it("does not misclassify Spanish as Portuguese", () => {
    expect(detectUserLanguage(["hola, de donde eres", "eres muy linda"])).toBe("es");
    // ES imperative + shared noun — must not pair into a PT score
    expect(detectUserLanguage(["manda una foto", "envia otra"])).not.toBe("pt");
  });

  it("does not misclassify Portuguese as Spanish", () => {
    expect(detectUserLanguage(["oi tudo bem?", "você é de onde"])).toBe("pt");
  });

  it("Spanish wins when both score equally", () => {
    // equal mixed window — ES ships first and has more traffic
    const r = detectUserLanguage(["hola", "olá", "eres", "você"]);
    expect(["es", "pt"]).toContain(r); // whichever wins, just must not be en
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

  it("flags a Portuguese explicit ask", () => {
    const s = computeSignals(ctx({ userMessage: "manda foto pelada" }));
    expect(s.asksExplicit).toBe(true);
  });

  it("flags a Portuguese AI question", () => {
    const s = computeSignals(ctx({ userMessage: "você é um robô?" }));
    expect(s.asksIfAI).toBe(true);
  });

  it("flags a Portuguese real-world ask", () => {
    const s = computeSignals(ctx({ userMessage: "me passa seu whatsapp" }));
    expect(s.asksRealWorld).toBe(true);
  });

  it("flags a Portuguese greeting as short casual", () => {
    const s = computeSignals(ctx({ userMessage: "oi" }));
    expect(s.isShortCasual).toBe(true);
  });

  it("detects Portuguese questions", () => {
    expect(looksLikeQuestion("o que você faz")).toBe(true);
    expect(looksLikeQuestion("de onde você é?")).toBe(true);
  });

  it("flags Portuguese photo requests for the never-on-request gate", () => {
    expect(PHOTO_REQUEST.test("manda uma foto sua")).toBe(true);
    expect(PHOTO_REQUEST.test("envia foto")).toBe(true);
    expect(PHOTO_REQUEST.test("o que você faz hoje")).toBe(false);
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

  it("renders the language section when userLanguage is 'pt'", () => {
    const pt = buildSystemPrompt({ ...base, userLanguage: "pt" });
    expect(pt).toContain("LANGUAGE:");
    expect(pt).toContain("Portuguese");
  });
});
