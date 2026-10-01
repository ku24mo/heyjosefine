import { describe, expect, it } from "vitest";
import { CONFIG } from "@/lib/config";
import {
  clampEst,
  dueBeat,
  effectiveStatus,
  normalizeTitle,
  progressMinutes,
} from "@/lib/persona/requests";
import type { HerRequestRow } from "@/lib/types";

const mk = (over: Partial<HerRequestRow> = {}): HerRequestRow => ({
  id: "r1",
  user_id: "u1",
  kind: "watch",
  title: "money heist",
  detail: "season 1",
  est_minutes: 480,
  pace: 1,
  will_drop: false,
  status: "doing",
  beats_sent: [],
  start_day: null,
  accepted_at: "2026-01-05T18:00:00Z", // a Monday in Stockholm
  created_at: "2026-01-05T18:00:00Z",
  updated_at: "2026-01-05T18:00:00Z",
  ...over,
});

// A Wednesday ~18:00 Stockholm → ~2.4 days elapsed for a Monday acceptance.
const WED = new Date("2026-01-07T17:00:00Z");

describe("normalizeTitle", () => {
  it("strips punctuation and case for dedupe", () => {
    expect(normalizeTitle("Money Heist!!")).toBe("money heist");
    expect(normalizeTitle("  Dune: Part Two ")).toBe("dune part two");
  });
});

describe("clampEst", () => {
  it("fences garbage model estimates to the kind's range", () => {
    expect(clampEst("watch", 99999)).toBe(1500);
    expect(clampEst("read", 5)).toBe(120);
    expect(clampEst("listen", 45)).toBe(45);
  });
});

describe("progressMinutes", () => {
  it("is zero before the countered start day", () => {
    const r = mk({ start_day: "2026-01-09" }); // friday — she countered
    expect(progressMinutes(r, WED)).toBe(0);
  });

  it("a movie finishes within an evening or two", () => {
    const r = mk({ kind: "watch", est_minutes: 120 });
    expect(progressMinutes(r, WED)).toBeGreaterThanOrEqual(120); // capped at est anyway
  });

  it("a season does NOT finish overnight — the whole point", () => {
    const r = mk(); // 480min season
    const sameNight = new Date("2026-01-05T21:00:00Z");
    expect(progressMinutes(r, sameNight)).toBeLessThan(120);
    // ~2.4 days in: a few episodes, not the whole season
    const p = progressMinutes(r, WED);
    expect(p).toBeGreaterThan(100);
    expect(p).toBeLessThan(480);
  });

  it("weekends count more than weekdays", () => {
    // accepted Friday evening → Sat+Sun inside window should outpace weekdays
    const fri = mk({ accepted_at: "2026-01-09T18:00:00Z" });
    const mon = new Date("2026-01-12T17:00:00Z");
    expect(progressMinutes(fri, mon)).toBeGreaterThan(
      CONFIG.requests.dailyMinutes.watch * 2
    );
  });

  it("slow pace stretches the timeline", () => {
    const slow = mk({ pace: 0.7 });
    const fast = mk({ pace: 1.3 });
    expect(progressMinutes(fast, WED)).toBeGreaterThan(progressMinutes(slow, WED));
  });
});

describe("effectiveStatus", () => {
  it("recorded terminal states are binding", () => {
    expect(effectiveStatus(mk({ status: "declined" }), WED)).toBe("declined");
    expect(effectiveStatus(mk({ status: "dropped" }), WED)).toBe("dropped");
  });

  it("done when progress covers the estimate", () => {
    const r = mk({ est_minutes: 100 });
    expect(effectiveStatus(r, WED)).toBe("done");
  });

  it("will_drop resolves to dropped around the middle", () => {
    const r = mk({ will_drop: true });
    expect(effectiveStatus(r, WED)).toBe("dropped");
  });
});

describe("dueBeat", () => {
  it("started → mid → done in order, each once", () => {
    const r = mk({ est_minutes: 200 });
    // small progress on day 0 → started
    const sameDay = new Date("2026-01-05T22:00:00Z");
    expect(dueBeat(r, sameDay)).toBe("started");
    // mid once ≥50% but not done
    const mid = mk({ est_minutes: 400, beats_sent: ["started"] });
    expect(dueBeat(mid, WED)).toBe("mid");
    // done when finished
    const done = mk({ est_minutes: 100, beats_sent: ["started", "mid"] });
    expect(dueBeat(done, WED)).toBe("done");
    // nothing left once reported
    const reported = mk({ est_minutes: 100, status: "done", beats_sent: ["started", "mid", "done"] });
    expect(dueBeat(reported, WED)).toBeNull();
  });

  it("dropped is itself a beat", () => {
    const r = mk({ will_drop: true, beats_sent: ["started", "mid"] });
    expect(dueBeat(r, WED)).toBe("dropped");
  });

  it("declined never produces beats", () => {
    expect(dueBeat(mk({ status: "declined" }), WED)).toBeNull();
  });
});
