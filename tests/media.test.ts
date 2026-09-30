import { describe, expect, it } from "vitest";
import { chooseAsset, type MediaAsset } from "@/lib/media/pick";

const asset = (over: Partial<MediaAsset>): MediaAsset => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  subject: "odin",
  tags: ["socks"],
  intimacy_tier: 1,
  unlock_day: 1,
  storage_path: "odin/d1-socks.jpg",
  ...over,
});

describe("chooseAsset — the backend picks the file, never the model", () => {
  it("returns null on an empty pool — callers degrade to text", () => {
    expect(chooseAsset([], { intent: null })).toBeNull();
  });

  it("never substitutes a random asset for a specific subject intent", () => {
    const food = [asset({ subject: "food" }), asset({ subject: "food" })];
    expect(
      chooseAsset(food, { intent: { subject: "odin", scene: null } })
    ).toBeNull();
  });

  it("resolves subject intent to only matching assets", () => {
    const pool = [
      asset({ subject: "food" }),
      asset({ subject: "odin", id: "a1" }),
      asset({ subject: "odin", id: "a2" }),
    ];
    const picked = chooseAsset(pool, {
      intent: { subject: "odin", scene: null },
    });
    expect(picked?.subject).toBe("odin");
  });

  it("prefers a scene-tag match within the subject", () => {
    const pool = [
      asset({ id: "lap", tags: ["asleep", "lap"] }),
      asset({ id: "sock", tags: ["socks", "crime"] }),
    ];
    const picked = chooseAsset(pool, {
      intent: { subject: "odin", scene: "socks" },
    });
    expect(picked?.id).toBe("sock");
  });

  it("no-intent (opener slot) picks any eligible asset", () => {
    const pool = [asset({ subject: "scene", tags: ["rain"] })];
    expect(chooseAsset(pool, { intent: null })).not.toBeNull();
  });

  it("comfortOnly restricts to comfort-tagged assets — the cheer-up path", () => {
    const pool = [
      asset({ tags: ["socks"] }),
      asset({ id: "hug", tags: ["comfort", "blanket"] }),
    ];
    expect(chooseAsset(pool, { intent: null, comfortOnly: true })?.id).toBe(
      "hug"
    );
  });

  it("comfortOnly + intent still honors the subject", () => {
    const pool = [
      asset({ subject: "odin", tags: ["comfort"] }),
      asset({ subject: "food", tags: ["comfort", "soup"], id: "soup" }),
    ];
    expect(
      chooseAsset(pool, {
        intent: { subject: "food", scene: null },
        comfortOnly: true,
      })?.id
    ).toBe("soup");
  });

  it("returns null when nothing comfort-tagged exists — suppression, not substitution", () => {
    const pool = [asset({ tags: ["party"] }), asset({ tags: ["club"] })];
    expect(chooseAsset(pool, { intent: null, comfortOnly: true })).toBeNull();
  });
});
