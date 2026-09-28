import { describe, expect, it } from "vitest";
import { herNow, herNowLine } from "@/lib/time";

// Fixed UTC instants mapped through Europe/Stockholm (UTC+2 in September).
const at = (iso: string) => new Date(iso);

describe("herNow", () => {
  it("maps hours to the right daypart", () => {
    expect(herNow(at("2026-09-28T05:30:00Z")).daypart).toBe("early_morning"); // 07:30
    expect(herNow(at("2026-09-28T09:00:00Z")).daypart).toBe("morning"); // 11:00
    expect(herNow(at("2026-09-28T11:30:00Z")).daypart).toBe("midday"); // 13:30
    expect(herNow(at("2026-09-28T14:00:00Z")).daypart).toBe("afternoon"); // 16:00
    expect(herNow(at("2026-09-28T18:30:00Z")).daypart).toBe("evening"); // 20:30
    expect(herNow(at("2026-09-28T22:30:00Z")).daypart).toBe("late_night"); // 00:30 next day
  });

  it("reports Stockholm-local weekday and time", () => {
    // 2026-09-28 is a Monday; 23:30 UTC = 01:30 Tuesday in Stockholm.
    const n = herNow(at("2026-09-28T23:30:00Z"));
    expect(n.weekday).toBe("Tuesday");
    expect(n.time).toBe("01:30");
    expect(n.date).toBe("2026-09-29");
  });

  it("formats a readable line", () => {
    expect(herNowLine(at("2026-09-28T18:30:00Z"))).toBe(
      "Monday 20:30 (evening)"
    );
  });
});
