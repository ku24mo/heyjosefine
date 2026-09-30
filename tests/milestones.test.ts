import { describe, expect, it } from "vitest";
import { MILESTONE_DAYS, nextMilestone } from "@/lib/ai/opening";

describe("nextMilestone", () => {
  it("fires on the exact milestone day", () => {
    for (const d of MILESTONE_DAYS) {
      expect(nextMilestone(d, 0)).toBe(d);
    }
  });

  it("returns null before the first milestone", () => {
    for (const d of [0, 1, 3, 6]) {
      expect(nextMilestone(d, 0)).toBeNull();
    }
  });

  it("between milestones stays quiet", () => {
    expect(nextMilestone(10, 7)).toBeNull();
    expect(nextMilestone(45, 30)).toBeNull();
  });

  it("catch-up fires only the highest uncelebrated milestone", () => {
    // gone 40 days, never celebrated → the month, not the week AND the month
    expect(nextMilestone(40, 0)).toBe(30);
    expect(nextMilestone(100, 14)).toBe(90);
  });

  it("never re-fires a celebrated milestone", () => {
    expect(nextMilestone(30, 30)).toBeNull();
    expect(nextMilestone(31, 30)).toBeNull();
  });

  it("still catches the next milestone after celebrating earlier ones", () => {
    expect(nextMilestone(60, 30)).toBe(60);
  });
});
