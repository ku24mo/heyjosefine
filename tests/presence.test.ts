import { describe, expect, it } from "vitest";
import { canInitiate, dailyVibe, herPresence } from "@/lib/persona/presence";
import { herNow } from "@/lib/time";

/** A Date whose Stockholm local hour is `h` (works regardless of test TZ). */
function atHour(h: number, base = new Date()): Date {
  const cur = herNow(base).hour;
  return new Date(base.getTime() + (h - cur) * 3_600_000);
}

const base = { userId: "u1", hasHistory: true, saidGoodnight: false, convoActive: false };

describe("herPresence", () => {
  it("is never a hard-out — deep night is still 'away', not silence", () => {
    expect(herPresence({ ...base, now: atHour(3) }).state).toBe("away");
    expect(herPresence({ ...base, now: atHour(1) }).state).toBe("away");
  });

  it("is away through the whole night window", () => {
    for (const h of [22, 23, 0, 3, 5, 7, 8]) {
      expect(herPresence({ ...base, now: atHour(h) }).state).toBe("away");
    }
  });

  it("is here during normal hours", () => {
    for (const h of [9, 12, 14, 19, 21]) {
      expect(herPresence({ ...base, now: atHour(h) }).state).toBe("here");
    }
  });

  it("a new user gets the same away/here semantics — never blocked", () => {
    expect(herPresence({ ...base, hasHistory: false, now: atHour(3) }).state).toBe("away");
    expect(herPresence({ ...base, hasHistory: false, now: atHour(14) }).state).toBe("here");
  });

  it("a declared goodnight keeps her away through the night", () => {
    expect(herPresence({ ...base, saidGoodnight: true, now: atHour(23) }).state).toBe("away");
    expect(herPresence({ ...base, saidGoodnight: true, now: atHour(2) }).state).toBe("away");
  });

  it("carries a prompt note when away, none when here", () => {
    expect(herPresence({ ...base, now: atHour(23) }).promptLine).toBeTruthy();
    expect(herPresence({ ...base, now: atHour(3) }).promptLine).toBeTruthy();
    expect(herPresence({ ...base, now: atHour(14) }).promptLine).toBeNull();
  });

  it("the deep-night note tells her to hint at sleep but keep answering", () => {
    const p = herPresence({ ...base, now: atHour(3) });
    expect(p.promptLine).toMatch(/crash|bed|asleep/i);
    expect(p.promptLine).toMatch(/keeps answering|still up/i);
  });
});

describe("canInitiate", () => {
  it("blocks proactive texts in dead-night hours", () => {
    for (const h of [0, 1, 3, 5, 6]) {
      expect(canInitiate(atHour(h))).toBe(false);
    }
  });

  it("allows proactive texts in waking hours", () => {
    for (const h of [7, 9, 12, 19, 22]) {
      expect(canInitiate(atHour(h))).toBe(true);
    }
  });
});

describe("dailyVibe", () => {
  it("is deterministic for the same user + day", () => {
    const now = new Date();
    expect(dailyVibe("u1", now)).toEqual(dailyVibe("u1", now));
  });

  it("produces a valid mood/energy pair", () => {
    const v = dailyVibe("u1");
    expect(["bright", "flat", "tired", "chaotic", "neutral"]).toContain(v.mood);
    expect(v.energy).toBeGreaterThan(0);
    expect(v.energy).toBeLessThanOrEqual(1);
  });

  it("differs across users or days", () => {
    const now = new Date();
    const vibes = new Set(
      ["a", "b", "c", "d", "e", "f"].map((u) => dailyVibe(u, now).mood)
    );
    // 6 users × same day should not all land on the identical mood forever
    expect(vibes.size).toBeGreaterThan(1);
  });
});
