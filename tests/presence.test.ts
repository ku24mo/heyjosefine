import { describe, expect, it } from "vitest";
import { saidGoodnightRecently } from "@/lib/ai/orchestrator";
import { canInitiate, dailyVibe, herPresence } from "@/lib/persona/presence";
import { herNow } from "@/lib/time";
import type { MessageRow } from "@/lib/types";

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

  it("post-goodnight switches to sleepy-still-answering, not another exit", () => {
    const p = herPresence({ ...base, saidGoodnight: true, now: atHour(23) });
    expect(p.state).toBe("away");
    expect(p.promptLine).toMatch(/said goodnight already/i);
    expect(p.promptLine).toMatch(/do not re-announce/i);
    // and it's a different instruction than the pre-goodnight hint line
    const hint = herPresence({ ...base, saidGoodnight: false, now: atHour(23) });
    expect(p.promptLine).not.toBe(hint.promptLine);
  });

  it("post-goodnight holds through deep night too", () => {
    const p = herPresence({ ...base, saidGoodnight: true, now: atHour(3) });
    expect(p.promptLine).toMatch(/said goodnight already/i);
  });

  it("a goodnight from last night is stale by daytime — no prompt note", () => {
    const p = herPresence({ ...base, saidGoodnight: true, now: atHour(10) });
    expect(p.state).toBe("here");
    expect(p.promptLine).toBeNull();
  });
});

describe("saidGoodnightRecently", () => {
  function msg(role: "user" | "assistant", content: string, ageMin: number): MessageRow {
    return {
      id: crypto.randomUUID(),
      conversation_id: "c1",
      role,
      content,
      meta: {},
      created_at: new Date(Date.now() - ageMin * 60_000).toISOString(),
    };
  }

  it("sees a goodnight even when later replies don't say 'night'", () => {
    const recent = [
      msg("assistant", "okay I'm actually going now. goodnight 😴", 30),
      msg("user", "just 10 more minutes", 25),
      msg("assistant", "ugh stop, I'm literally falling asleep", 20),
      msg("user", "u don't wanna leave", 15),
      msg("assistant", "bold thing to say", 10),
    ];
    expect(saidGoodnightRecently(recent)).toBe(true);
  });

  it("is false when no assistant message declared sleep", () => {
    const recent = [
      msg("assistant", "lol what are you on about", 10),
      msg("user", "tell me more", 5),
    ];
    expect(saidGoodnightRecently(recent)).toBe(false);
  });

  it("expires — a goodnight older than 8h doesn't count", () => {
    const recent = [
      msg("assistant", "goodnight 😴", 9 * 60),
      msg("assistant", "morning ☕️", 30),
    ];
    expect(saidGoodnightRecently(recent)).toBe(false);
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
