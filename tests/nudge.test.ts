import { describe, expect, it } from "vitest";
import { shouldNudge } from "@/lib/ai/nudge";
import type { MessageRow } from "@/lib/types";

type RecentMsg = Pick<MessageRow, "role" | "content" | "created_at" | "meta">;

const NOW = new Date("2026-02-01T14:00:00Z"); // 15:00 Stockholm (CET)
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const msg = (
  role: "user" | "assistant",
  content: string,
  minAgo: number,
  meta: MessageRow["meta"] = {}
): RecentMsg => ({ role, content, created_at: ago(minAgo), meta });

/** Active conversation, her reply 20 min ago — the canonical nudge window. */
const flowing: RecentMsg[] = [
  msg("user", "what do you do?", 40),
  msg("assistant", "law student, second year", 38),
  msg("user", "oh smarty pants", 35),
  msg("assistant", "stop 😂", 20),
];

describe("shouldNudge", () => {
  it("fires when her bubble is last and he went quiet mid-flow", () => {
    const w = shouldNudge(flowing, NOW);
    expect(w).not.toBeNull();
    expect(w!.minutesQuiet).toBeCloseTo(20);
    expect(w!.herLastWasQuestion).toBe(false);
  });

  it("flags when her last bubble was a question (statement-only nudge)", () => {
    const w = shouldNudge(
      [...flowing.slice(0, -1), msg("assistant", "wait what do you do?", 20)],
      NOW
    );
    expect(w!.herLastWasQuestion).toBe(true);
  });

  it("stays quiet when HIS message is last", () => {
    expect(
      shouldNudge([...flowing, msg("user", "and then?", 5)], NOW)
    ).toBeNull();
  });

  it("stays quiet inside the impatient window and past the gone window", () => {
    const tooSoon = [...flowing.slice(0, -1), msg("assistant", "stop 😂", 3)];
    const tooLate = [...flowing.slice(0, -1), msg("assistant", "stop 😂", 60)];
    expect(shouldNudge(tooSoon, NOW)).toBeNull();
    expect(shouldNudge(tooLate, NOW)).toBeNull();
  });

  it("respects exits — goodnight or bye from either side", () => {
    const afterGn = [
      msg("user", "what's up", 30),
      msg("user", "long day", 28),
      msg("user", "night 😴", 25),
      msg("assistant", "mhm. night", 20),
    ];
    expect(shouldNudge(afterGn, NOW)).toBeNull();

    const afterBye = [
      msg("user", "what's up", 30),
      msg("user", "long day", 28),
      msg("user", "gtg, dinner", 25),
      msg("assistant", "okay cya", 20),
    ];
    expect(shouldNudge(afterBye, NOW)).toBeNull();
  });

  it("never double-texts twice on the same silence", () => {
    const already = [
      ...flowing,
      msg("assistant", "wait, what do you actually do?", 15, { nudge: true }),
    ];
    // now her nudge is the last msg 15min ago — in window, but already used
    expect(shouldNudge(already, NOW)).toBeNull();
  });

  it("requires he was actually there — no nudging a stranger", () => {
    const stranger = [
      msg("assistant", "so you're the new one 👀", 25),
      msg("assistant", "anyone home", 20, { nudge: false }),
    ];
    expect(shouldNudge(stranger, NOW)).toBeNull();
  });

  it("doesn't resurrect a softly-closed thread", () => {
    const closed = [
      msg("user", "what do you do?", 40),
      msg("assistant", "law student", 38),
      msg("user", "lol", 30),
      msg("assistant", "😂", 20),
    ];
    expect(shouldNudge(closed, NOW)).toBeNull();
  });

  it("respects the daily cap", () => {
    const capped = [
      msg("user", "hey", 400),
      msg("assistant", "hi", 399, { nudge: true }),
      msg("user", "sup", 300),
      msg("assistant", "hi again", 299, { nudge: true }),
      msg("user", "busy?", 200),
      msg("assistant", "kinda", 199, { nudge: true }),
      ...flowing,
    ];
    expect(shouldNudge(capped, NOW)).toBeNull();
  });

  it("doesn't fire in dead-night Stockholm hours", () => {
    const night = new Date("2026-02-01T02:00:00Z"); // 03:00 Stockholm
    const recent = [
      msg("user", "still up?", 240), // these timestamps are relative to NOW
      msg("user", "same", 235),
      msg("assistant", "ugh", 230),
    ].map((m) => ({
      ...m,
      created_at: new Date(night.getTime() - 20 * 60_000).toISOString(),
    }));
    expect(shouldNudge(recent, night)).toBeNull();
  });
});
