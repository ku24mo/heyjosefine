import { describe, expect, it } from "vitest";
import { dailyVibe, herPresence } from "@/lib/persona/presence";
import { herNow } from "@/lib/time";

/** A Date whose Stockholm local hour is `h` (works regardless of test TZ). */
function atHour(h: number, base = new Date()): Date {
  const cur = herNow(base).hour;
  return new Date(base.getTime() + (h - cur) * 3_600_000);
}

const base = { userId: "u1", hasHistory: true, saidGoodnight: false, convoActive: false };

describe("herPresence", () => {
  it("is out in deep night for an existing conversation", () => {
    expect(herPresence({ ...base, now: atHour(3) }).state).toBe("out");
  });

  it("never goes fully silent on a brand-new user", () => {
    expect(herPresence({ ...base, hasHistory: false, now: atHour(3) }).state).toBe(
      "fading"
    );
    expect(herPresence({ ...base, hasHistory: false, now: atHour(23) }).state).toBe(
      "fading"
    );
  });

  it("fades in the winding-down window and early morning", () => {
    expect(herPresence({ ...base, now: atHour(23) }).state).toBe("fading");
    expect(herPresence({ ...base, now: atHour(8) }).state).toBe("fading");
    expect(herPresence({ ...base, now: atHour(0) }).state).toBe("fading");
  });

  it("is here during normal hours", () => {
    expect(herPresence({ ...base, now: atHour(14) }).state).toBe("here");
  });

  it("a declared goodnight is binding until morning", () => {
    expect(herPresence({ ...base, saidGoodnight: true, now: atHour(23) }).state).toBe("out");
    expect(herPresence({ ...base, saidGoodnight: true, now: atHour(2) }).state).toBe("out");
  });

  it("a live conversation keeps her up at the small-hours edge", () => {
    const p = herPresence({ ...base, convoActive: true, now: atHour(1) });
    expect(p.state).toBe("fading");
  });

  it("the 1-2am edge follows the day-seeded night-owl flag", () => {
    const now = atHour(1);
    const vibe = dailyVibe(base.userId, now);
    const p = herPresence({ ...base, now });
    expect(p.state).toBe(vibe.staysUpLate ? "fading" : "out");
  });

  it("carries a prompt note when fading, none when here", () => {
    expect(herPresence({ ...base, now: atHour(23) }).promptLine).toBeTruthy();
    expect(herPresence({ ...base, now: atHour(14) }).promptLine).toBeNull();
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
