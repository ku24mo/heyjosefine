import { describe, expect, it } from "vitest";
import {
  computeFamiliarity,
  decayed,
  pushActs,
  validBeatTransition,
} from "@/lib/state/conversation";
import { makeState } from "./fixtures";

describe("familiarity — trust is earned over days", () => {
  it("stays low on day one regardless of activity", () => {
    const s = makeState();
    const r = computeFamiliarity(s, { meaningfulExchange: true });
    expect(r.familiarity).toBeLessThanOrEqual(6);
    expect(r.stage).toBe("new");
  });

  it("grows across distinct days, capped", () => {
    const dates = Array.from({ length: 10 }, (_, i) =>
      new Date(Date.now() - (10 - i) * 86_400_000).toISOString().slice(0, 10)
    );
    const s = makeState({ active_dates: dates, days_active: 10 });
    const r = computeFamiliarity(s);
    expect(r.familiarity).toBeGreaterThan(15);
    expect(["warming", "familiar"]).toContain(r.stage);
  });

  it("many days alone caps below 'close' — depth matters", () => {
    const dates = Array.from({ length: 30 }, (_, i) =>
      new Date(Date.now() - (30 - i) * 86_400_000).toISOString().slice(0, 10)
    );
    const s = makeState({ active_dates: dates, days_active: 30 });
    const r = computeFamiliarity(s, { meaningfulExchange: false });
    expect(r.familiarity).toBeLessThanOrEqual(61);
  });
});

describe("beats", () => {
  it("allows natural progression problem → explore → reflect", () => {
    expect(validBeatTransition("problem_introduced", "exploring")).toBe(true);
    expect(validBeatTransition("exploring", "deeper_context")).toBe(true);
    expect(validBeatTransition("deeper_context", "reflection")).toBe(true);
  });

  it("blocks premature jumps to action", () => {
    expect(validBeatTransition("problem_introduced", "action")).toBe(false);
    expect(validBeatTransition("exploring", "decision")).toBe(false);
  });

  it("always allows falling back to free_chat", () => {
    expect(validBeatTransition("reflection", "free_chat")).toBe(true);
  });
});

describe("mood momentum", () => {
  it("decays toward baseline rather than resetting", () => {
    expect(decayed(1.0, 0.7)).toBeLessThan(1.0);
    expect(decayed(1.0, 0.7)).toBeGreaterThan(0.7);
    expect(decayed(0.0, 0.7)).toBeGreaterThan(0.0);
  });
});

describe("act histogram", () => {
  it("accumulates acts for reciprocity tracking", () => {
    const h = pushActs({ ask: 3 }, ["react", "ask"]);
    expect(h.ask).toBe(4);
    expect(h.react).toBe(1);
  });
});
