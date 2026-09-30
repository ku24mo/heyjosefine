import { describe, expect, it } from "vitest";
import { resolveDayHint, slotNow, dayLine, slotToSubjects } from "@/lib/persona/day";
import type { HerDaySlot } from "@/lib/types";

// Fix "now" at a known instant; herNow() converts to Stockholm internally.
// 2025-10-02 is a Thursday. Use a fixed instant + explicit Stockholm offsets.
const NOW = new Date("2025-10-02T12:00:00Z"); // 14:00 Stockholm (CEST, +2)

describe("resolveDayHint — chat promises become schedule", () => {
  it("tomorrow → next Stockholm date", () => {
    expect(resolveDayHint("tomorrow", NOW)).toBe("2025-10-03");
  });

  it("today → today", () => {
    expect(resolveDayHint("today", NOW)).toBe("2025-10-02");
  });

  it("iso date passes through", () => {
    expect(resolveDayHint("2025-10-15", NOW)).toBe("2025-10-15");
  });

  it("weekday name → next occurrence (never today)", () => {
    // Thursday the 2nd → "friday" = the 3rd; "thursday" = next Thursday
    expect(resolveDayHint("friday", NOW)).toBe("2025-10-03");
    expect(resolveDayHint("thursday", NOW)).toBe("2025-10-09");
    expect(resolveDayHint("sunday", NOW)).toBe("2025-10-05");
  });

  it("garbage / vague hints → null", () => {
    expect(resolveDayHint("sometime this week", NOW)).toBeNull();
    expect(resolveDayHint("maybe", NOW)).toBeNull();
    expect(resolveDayHint(null, NOW)).toBeNull();
  });
});

describe("slotNow — where she is right now", () => {
  const slots: HerDaySlot[] = [
    { start: "08:00", end: "10:00", label: "lecture", kind: "uni" },
    { start: "13:00", end: "16:00", label: "library", kind: "uni" },
    { start: "18:00", end: "19:30", label: "gym", kind: "gym" },
  ];

  it("returns the slot covering current time", () => {
    // 14:00 Stockholm → library
    expect(slotNow(slots, NOW)?.label).toBe("library");
  });

  it("gap within an hour after a slot still counts as it winding down", () => {
    const tenThirty = new Date("2025-10-02T08:30:00Z"); // 10:30 Stockholm
    expect(slotNow(slots, tenThirty)?.label).toBe("lecture");
  });

  it("gap beyond the grace hour → between things (null)", () => {
    const elevenThirty = new Date("2025-10-02T09:30:00Z"); // 11:30 Stockholm
    expect(slotNow(slots, elevenThirty)).toBeNull();
  });

  it("early morning before any slot → null", () => {
    const fiveAm = new Date("2025-10-02T03:00:00Z"); // 05:00 Stockholm
    expect(slotNow(slots, fiveAm)).toBeNull();
  });
});

describe("dayLine / slotToSubjects", () => {
  it("renders a compact schedule with the current slot", () => {
    const line = dayLine(
      {
        day: "2025-10-02",
        slots: [
          { start: "08:00", end: "10:00", label: "lecture", kind: "uni" },
          { start: "13:00", end: "16:00", label: "library", kind: "uni" },
        ],
        headline: null,
        generated_at: "",
      },
      NOW
    );
    expect(line).toContain("lecture");
    expect(line).toContain("right now: library");
  });

  it("empty day → empty string", () => {
    expect(dayLine(null, NOW)).toBe("");
    expect(
      dayLine({ day: "x", slots: [], headline: null, generated_at: "" }, NOW)
    ).toBe("");
  });

  it("maps slot kinds to plausible photo subjects", () => {
    expect(slotToSubjects("gym")).toContain("gym");
    expect(slotToSubjects("parents")).toContain("food");
    expect(slotToSubjects("uni")).not.toContain("gym");
    expect(slotToSubjects("unknown")).toEqual([]);
  });
});
